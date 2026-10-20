import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryState } from './helpers.js';

const execute = promisify(execFile);

async function fixture() {
  const state = await temporaryState();
  const posted: { body: unknown; idempotencyKey: string | string[] | undefined }[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/feed.json') {
      response.end(JSON.stringify({ items: [{ id: 'fixture-1', content_text: 'Fixture post' }] }));
    } else if (request.url === '/bad-feed.json') {
      response.writeHead(503).end(JSON.stringify({ error: 'Unavailable' }));
    } else if (request.url === '/api/v1/accounts/verify_credentials') {
      response.end(JSON.stringify({ id: 'account-1', username: 'fixture' }));
    } else if (request.url === '/api/v1/statuses') {
      void text(request)
        .then((body) => {
          posted.push({
            body: JSON.parse(body),
            idempotencyKey: request.headers['idempotency-key'],
          });
          response.end(JSON.stringify({ id: 'status-1' }));
        })
        .catch(() => {
          response.writeHead(500).end('{}');
        });
    } else {
      response.writeHead(404).end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server');
  const base = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    DOTENV_CONFIG_PATH: join(state.directory, 'missing.env'),
    FEED_URLS: `${base}/feed.json`,
    MASTODON_URL: base,
    MASTODON_ACCESS_TOKEN: 'local-fixture-token',
    STATE_PATH: state.path,
    RETRY_ATTEMPTS: '0',
    POST_DELAY_MS: '0',
  };
  return {
    env,
    posted,
    base,
    state,
    run: () => execute(process.execPath, ['--import', 'tsx', 'src/index.ts', '--once'], { env }),
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await state.cleanup();
    },
  };
}

describe('CLI', () => {
  it('exits nonzero with actionable configuration errors before any network calls', async () => {
    const result = execute(process.execPath, ['--import', 'tsx', 'src/index.ts', '--once'], {
      env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: '/nonexistent/test-env' },
    });
    await expect(result).rejects.toHaveProperty('code', 1);
    await expect(result).rejects.toHaveProperty(
      'stderr',
      expect.stringContaining('Invalid configuration: FEED_URLS, MASTODON_ACCESS_TOKEN'),
    );
  });

  it('syncs end-to-end and does not repost after a process restart', async () => {
    const app = await fixture();
    try {
      const result = await app.run();
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Sync completed');
      expect(app.posted).toHaveLength(1);
      expect(app.posted[0]?.body).toMatchObject({ status: 'Fixture post' });
      expect(app.posted[0]?.idempotencyKey).toMatch(/^[a-f0-9]{16}$/);
      const state: unknown = JSON.parse(await readFile(app.state.path, 'utf8'));
      expect(state).toMatchObject({ stats: { total: 1, failed: 0 } });
      await app.run();
      expect(app.posted).toHaveLength(1);
    } finally {
      await app.cleanup();
    }
  });

  it('exits nonzero on a partial feed failure while persisting successful work', async () => {
    const app = await fixture();
    app.env.FEED_URLS = `${app.base}/feed.json,${app.base}/bad-feed.json`;
    try {
      await expect(app.run()).rejects.toHaveProperty('code', 1);
      expect(app.posted).toHaveLength(1);
      const state: unknown = JSON.parse(await readFile(app.state.path, 'utf8'));
      expect(state).toMatchObject({ stats: { total: 1 } });
    } finally {
      await app.cleanup();
    }
  });
});

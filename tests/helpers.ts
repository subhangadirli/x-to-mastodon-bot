import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { loadConfig } from '../src/config.js';
import type { FeedItem } from '../src/types.js';

export const logger = pino({ level: 'silent' });

export function config() {
  return loadConfig(
    {
      FEED_URLS: 'https://example.com/feed.json',
      MASTODON_URL: 'https://mastodon.example',
      MASTODON_ACCESS_TOKEN: 'test-token',
      RETRY_ATTEMPTS: '0',
      POST_DELAY_MS: '0',
    },
    [],
  );
}

export function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'test-item',
    title: 'A post',
    content: 'Post content',
    url: 'https://example.com/post',
    media: [],
    publishedAt: 1,
    author: 'Author',
    ...overrides,
  };
}

export async function temporaryState() {
  const directory = await mkdtemp(join(tmpdir(), 'x-to-mastodon-test-'));
  return {
    directory,
    path: join(directory, 'sync_state.json'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

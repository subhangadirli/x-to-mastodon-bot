import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const env = { FEED_URLS: 'https://example.com/feed.json', MASTODON_ACCESS_TOKEN: 'test-token' };

describe('configuration', () => {
  it('provides validated defaults', () => {
    const result = loadConfig(env, []);
    expect(result.mastodonUrl).toBe('https://mastodon.social');
    expect(result.maxPostsPerCheck).toBe(5);
    expect(result.once).toBe(false);
  });

  it('accepts comma- and whitespace-separated feeds and removes duplicates', () => {
    expect(
      loadConfig(
        {
          ...env,
          FEED_URLS: 'https://a.example/feed, https://b.example/feed\nhttps://a.example/feed',
        },
        [],
      ).feedUrls,
    ).toEqual(['https://a.example/feed', 'https://b.example/feed']);
  });

  it.each(['--once', 'CI'])('supports one-shot mode via %s', (mode) => {
    expect(
      loadConfig({ ...env, CI: mode === 'CI' ? 'true' : 'false' }, mode === '--once' ? [mode] : [])
        .once,
    ).toBe(true);
  });

  it.each([
    { FEED_URLS: undefined },
    { FEED_URLS: '  ' },
    { FEED_URLS: ',' },
    { FEED_URLS: 'file:///etc/passwd' },
    { FEED_URLS: 'https://user:password@example.com' },
    { FEED_URLS: 'not-a-url' },
    { MASTODON_ACCESS_TOKEN: '' },
    { MASTODON_URL: 'ftp://example.com' },
    { MAX_POSTS_PER_CHECK: '0' },
    { MAX_POSTS_PER_CHECK: '1.5' },
    { RETRY_ATTEMPTS: '-1' },
    { REQUEST_TIMEOUT_MS: '2147483648' },
    { MAX_MEDIA_BYTES: 'NaN' },
    { MASTODON_VISIBILITY: 'invalid' },
    { LOG_LEVEL: 'verbose' },
  ])('rejects invalid values: %j', (overrides) => {
    expect(() => loadConfig({ ...env, ...overrides }, [])).toThrow('Invalid configuration');
  });

  it('never echoes sensitive configuration values in validation errors', () => {
    expect(() => loadConfig({ ...env, MASTODON_URL: 'secret-value' }, [])).toThrow('MASTODON_URL');
    try {
      loadConfig({ ...env, MASTODON_URL: 'secret-value' }, []);
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });

  it('rejects unknown arguments', () => {
    expect(() => loadConfig(env, ['--typo'])).toThrow('Unknown argument');
  });

  it('allows disabling attachments, retries, and delay', () => {
    const result = loadConfig(
      { ...env, MAX_MEDIA_ATTACHMENTS: '0', RETRY_ATTEMPTS: '0', POST_DELAY_MS: '0' },
      [],
    );
    expect(result.maxMediaAttachments).toBe(0);
    expect(result.retryAttempts).toBe(0);
    expect(result.postDelayMs).toBe(0);
  });
});

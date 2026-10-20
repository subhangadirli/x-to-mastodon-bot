import { z } from 'zod';

const httpUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
}, 'Must be an HTTP(S) URL without embedded credentials');

const integer = (fallback: number, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback);

const environmentSchema = z.object({
  FEED_URLS: z.string().trim().min(1),
  MASTODON_URL: httpUrl.default('https://mastodon.social'),
  MASTODON_ACCESS_TOKEN: z.string().trim().min(1),
  MASTODON_VISIBILITY: z.enum(['public', 'unlisted', 'private', 'direct']).default('public'),
  CHECK_INTERVAL_MS: integer(900_000, 1_000, 2_147_483_647),
  MAX_POSTS_PER_CHECK: integer(5, 1, 1_000),
  MAX_STATUS_LENGTH: integer(500, 32, 100_000),
  MAX_MEDIA_ATTACHMENTS: integer(4, 0, 16),
  REQUEST_TIMEOUT_MS: integer(30_000, 1, 2_147_483_647),
  MEDIA_TIMEOUT_MS: integer(60_000, 1, 2_147_483_647),
  MAX_MEDIA_BYTES: integer(40 * 1024 * 1024),
  MAX_FEED_BYTES: integer(5 * 1024 * 1024),
  RETRY_ATTEMPTS: integer(3, 0, 10),
  POST_DELAY_MS: integer(3_000, 0, 2_147_483_647),
  STATE_PATH: z.string().trim().min(1).default('./sync_state.json'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv = process.argv.slice(2)) {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    // Report field names, never the environment values (which may contain credentials).
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid configuration: ${fields.join(', ')}. See .env.example.`);
  }

  const urls = result.data.FEED_URLS.split(/[\s,]+/).filter(Boolean);
  const feedUrls = z.array(httpUrl).min(1).safeParse(urls);
  if (!feedUrls.success) {
    throw new Error('Invalid configuration: FEED_URLS must contain HTTP(S) URLs.');
  }
  const unknownArgs = argv.filter((arg) => arg !== '--once');
  if (unknownArgs.length > 0) throw new Error('Unknown argument. Supported option: --once');

  const values = result.data;
  return {
    feedUrls: [...new Set(feedUrls.data)],
    mastodonUrl: values.MASTODON_URL,
    accessToken: values.MASTODON_ACCESS_TOKEN,
    visibility: values.MASTODON_VISIBILITY,
    checkIntervalMs: values.CHECK_INTERVAL_MS,
    maxPostsPerCheck: values.MAX_POSTS_PER_CHECK,
    maxStatusLength: values.MAX_STATUS_LENGTH,
    maxMediaAttachments: values.MAX_MEDIA_ATTACHMENTS,
    requestTimeoutMs: values.REQUEST_TIMEOUT_MS,
    mediaTimeoutMs: values.MEDIA_TIMEOUT_MS,
    maxMediaBytes: values.MAX_MEDIA_BYTES,
    maxFeedBytes: values.MAX_FEED_BYTES,
    retryAttempts: values.RETRY_ATTEMPTS,
    postDelayMs: values.POST_DELAY_MS,
    statePath: values.STATE_PATH,
    logLevel: values.LOG_LEVEL,
    once: env.CI === 'true' || argv.includes('--once'),
  };
}

export type Config = ReturnType<typeof loadConfig>;

import { createRestAPIClient } from 'masto';
import type { mastodon } from 'masto';
import type { Config } from './config.js';
import { readLimitedBody, retry } from './http.js';
import type { FeedItem, MediaItem, Publisher } from './types.js';

function truncate(text: string, maximum: number): string {
  const points = Array.from(text);
  if (points.length <= maximum) return text;
  if (maximum <= 0) return '';
  return points.slice(0, maximum - 1).join('') + '…';
}

/** Conservative code-point counting; never split emoji surrogate pairs or cut the source link. */
export function formatStatus(item: FeedItem, maximum: number): string {
  const text = item.title || item.content;
  const suffix = item.url ? `\n\n🔗 ${item.url}` : '';
  if (Array.from(suffix).length > maximum) return truncate(text, maximum);
  return truncate(text, maximum - Array.from(suffix).length) + suffix;
}

export class MastodonClient implements Publisher {
  private readonly client: mastodon.rest.Client;

  constructor(
    private readonly config: Config,
    client?: mastodon.rest.Client,
  ) {
    this.client =
      client ??
      createRestAPIClient({
        url: config.mastodonUrl,
        accessToken: config.accessToken,
        timeout: config.requestTimeoutMs,
        mediaTimeout: config.mediaTimeoutMs,
      });
  }

  async verifyCredentials(): Promise<void> {
    await retry(() => this.client.v1.accounts.verifyCredentials(), this.config.retryAttempts);
  }

  async uploadMedia(item: MediaItem): Promise<string> {
    // Retry the download independently, avoiding re-uploading successfully downloaded files.
    const file = await retry(async () => {
      const response = await fetch(item.url, {
        signal: AbortSignal.timeout(this.config.mediaTimeoutMs),
        headers: { 'User-Agent': 'XToMastodonBot/1.0' },
      });
      const body = await readLimitedBody(response, this.config.maxMediaBytes);
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (!contentType || !/^(image|video)\//i.test(contentType)) {
        throw new Error('Media response must have an image or video content type');
      }
      return new Blob([new Uint8Array(body)], { type: contentType });
    }, this.config.retryAttempts);

    const attachment = await retry(
      () =>
        this.client.v2.media.create({
          file,
          ...(item.description
            ? { description: Array.from(item.description).slice(0, 1_500).join('') }
            : {}),
        }),
      this.config.retryAttempts,
    );
    return attachment.id;
  }

  async postStatus(item: FeedItem, mediaIds: string[]): Promise<void> {
    const status = formatStatus(item, this.config.maxStatusLength);
    if (!status.trim() && mediaIds.length === 0) throw new Error('Cannot publish an empty status');
    await retry(
      () =>
        this.client.v1.statuses.create(
          { status, visibility: this.config.visibility, ...(mediaIds.length ? { mediaIds } : {}) },
          { requestInit: { headers: { 'Idempotency-Key': item.id } } },
        ),
      this.config.retryAttempts,
    );
  }
}

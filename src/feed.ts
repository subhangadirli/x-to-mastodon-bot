import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Config } from './config.js';
import { readLimitedBody, retry } from './http.js';
import type { FeedItem, FeedResult, MediaItem } from './types.js';

const authorSchema = z.object({ name: z.string().optional() });
const itemSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  external_url: z.string().optional(),
  title: z.string().optional(),
  content_text: z.string().optional(),
  content_html: z.string().optional(),
  image: z.string().optional(),
  banner_image: z.string().optional(),
  date_published: z.string().optional(),
  authors: z.array(authorSchema).optional(),
  author: authorSchema.optional(),
  attachments: z
    .array(
      z.object({
        url: z.string(),
        mime_type: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional(),
});
const feedSchema = z.object({ title: z.string().optional(), items: z.array(z.unknown()) });
type JsonFeedItem = z.infer<typeof itemSchema>;

function resolveHttpUrl(value: string | undefined, base: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function stripHtml(html: string): string {
  const $ = load(html);
  $('script, style, noscript').remove();
  $('br').replaceWith('\n');
  $('p, div, li, blockquote, h1, h2, h3').append('\n');
  return $.root()
    .text()
    .replace(/[\t \u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractMedia(item: JsonFeedItem, base: string, maximum: number): MediaItem[] {
  const media = new Map<string, MediaItem>();
  const add = (value: string | undefined, mime = '', description = '') => {
    const url = resolveHttpUrl(value, base);
    if (!url || media.has(url) || (mime && !/^(image|video)(\/|$)/i.test(mime))) return;
    const type =
      /^video/i.test(mime) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? 'video' : 'image';
    media.set(url, { url, type, description });
  };
  // Prefer explicit attachments: these carry MIME types and accessible descriptions.
  for (const attachment of item.attachments ?? []) {
    add(attachment.url, attachment.mime_type, attachment.title);
  }
  add(item.image);
  add(item.banner_image);
  if (item.content_html) {
    const $ = load(item.content_html);
    $('img, video, video source').each((_, element) => {
      const node = $(element);
      add(node.attr('src'), element.tagName === 'img' ? 'image' : 'video', node.attr('alt'));
    });
  }
  return [...media.values()].slice(0, maximum);
}

export function parseFeed(
  data: unknown,
  feedUrl: string,
  maxMedia: number,
  logger: Logger,
): FeedItem[] {
  const feed = feedSchema.parse(data);
  const items: FeedItem[] = [];
  for (const raw of feed.items) {
    const result = itemSchema.safeParse(raw);
    if (!result.success) {
      logger.warn('Skipping malformed feed item');
      continue;
    }
    const item = result.data;
    // Keep the original identifier algorithm so existing sync_state.json files still work.
    const identifier = item.id || item.url || item.title || JSON.stringify(raw);
    const url = resolveHttpUrl(item.url || item.external_url, feedUrl);
    const title = item.title?.trim() ?? '';
    const content = item.content_text?.trim() || stripHtml(item.content_html ?? '');
    const media = extractMedia(item, url || feedUrl, maxMedia);
    if (!title && !content && !url && media.length === 0) {
      logger.warn('Skipping empty feed item');
      continue;
    }
    const publishedAt = Date.parse(item.date_published ?? '');
    items.push({
      id: createHash('sha256').update(identifier).digest('hex').slice(0, 16),
      title,
      content,
      url,
      media,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
      author: item.authors?.[0]?.name || item.author?.name || feed.title || '',
    });
  }
  return items;
}

export class FeedProcessor {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  async fetchFeeds(): Promise<FeedResult> {
    const results = await Promise.allSettled(
      this.config.feedUrls.map((url) => this.fetchFeed(url)),
    );
    const items: FeedItem[] = [];
    let failedFeeds = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') items.push(...result.value);
      else {
        failedFeeds++;
        // Feed URLs can contain private RSS service keys; don't log them or response bodies.
        this.logger.error('Feed could not be fetched or validated');
      }
    }
    return { items, failedFeeds };
  }

  private async fetchFeed(url: string): Promise<FeedItem[]> {
    return retry(async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: {
          Accept: 'application/feed+json, application/json',
          'User-Agent': 'XToMastodonBot/1.0',
        },
      });
      const body = await readLimitedBody(response, this.config.maxFeedBytes);
      const data: unknown = JSON.parse(new TextDecoder().decode(body));
      return parseFeed(data, url, this.config.maxMediaAttachments, this.logger);
    }, this.config.retryAttempts);
  }
}

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { extractMedia, FeedProcessor, parseFeed, stripHtml } from '../src/feed.js';
import { config, logger } from './helpers.js';

const feedUrl = 'https://example.com/feed.json';
const parse = (items: unknown[]) => parseFeed({ title: 'Feed author', items }, feedUrl, 4, logger);

describe('feed parsing', () => {
  it('uses the feed title as the author fallback without crashing', () => {
    expect(parse([{ id: '1', content_text: 'Hello' }])[0]?.author).toBe('Feed author');
  });

  it('preserves existing persisted item IDs', () => {
    expect(parse([{ id: 'original-id', title: 'Hello' }])[0]?.id).toBe(
      createHash('sha256').update('original-id').digest('hex').slice(0, 16),
    );
  });

  it('uses URL, title, and original JSON as identifier fallbacks', () => {
    for (const raw of [
      { url: 'https://example.com/post' },
      { title: 'Title' },
      { content_text: 'Text', custom: true },
    ]) {
      const identifier = 'url' in raw ? raw.url : 'title' in raw ? raw.title : JSON.stringify(raw);
      expect(parse([raw])[0]?.id).toBe(
        createHash('sha256').update(identifier).digest('hex').slice(0, 16),
      );
    }
  });

  it('handles authors, dates, external links, and HTML fallback', () => {
    const result = parse([
      {
        content_html: '<p>Hello &amp; world</p>',
        external_url: '/post',
        authors: [{ name: 'Alice' }],
        date_published: '2026-01-01T00:00:00Z',
      },
      { content_text: 'Text', author: { name: 'Bob' }, date_published: 'bad date' },
    ]);
    expect(result[0]).toMatchObject({
      content: 'Hello & world',
      url: 'https://example.com/post',
      author: 'Alice',
      publishedAt: Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(result[1]).toMatchObject({ author: 'Bob', publishedAt: 0 });
  });

  it('skips malformed and empty items but accepts media-only items', () => {
    expect(parse([null, { title: 42 }, {}, { image: '/photo.jpg' }])).toHaveLength(1);
  });

  it('supports a feed without a title and rejects invalid top-level data', () => {
    expect(parseFeed({ items: [{ content_text: 'Text' }] }, feedUrl, 4, logger)[0]?.author).toBe(
      '',
    );
    expect(() => parseFeed({ items: {} }, feedUrl, 4, logger)).toThrow();
  });

  it('drops unsafe or malformed links', () => {
    expect(parse([{ title: 'Text', url: 'javascript:alert(1)' }])[0]?.url).toBe('');
    expect(parse([{ title: 'Text', url: 'https://[' }])[0]?.url).toBe('');
  });
});

describe('HTML and media', () => {
  it('decodes entities, retains paragraph breaks, and removes executable text', () => {
    expect(
      stripHtml(
        '<script>bad()</script><style>bad</style><p>A&#39;s &amp; B&nbsp; C</p><p>Next<br>line &#x1F600;</p>',
      ),
    ).toBe("A's & B C\nNext\nline 😀");
  });

  it('deduplicates all sources and recognizes MIME videos and query-string extensions', () => {
    const media = extractMedia(
      {
        image: '/photo.jpg',
        banner_image: '/photo.jpg',
        attachments: [
          { url: '/photo.jpg', mime_type: 'image/jpeg', title: 'Alt text' },
          { url: '/clip.mp4?x=1', mime_type: 'video/mp4' },
          { url: '/audio.mp3', mime_type: 'audio/mpeg' },
        ],
        content_html:
          '<img src="/extra.png" alt="Extra"><video><source src="/other.webm"></video><img src="data:image/png;base64,AAA">',
      },
      feedUrl,
      4,
    );
    expect(media).toEqual([
      { url: 'https://example.com/photo.jpg', type: 'image', description: 'Alt text' },
      { url: 'https://example.com/clip.mp4?x=1', type: 'video', description: '' },
      { url: 'https://example.com/extra.png', type: 'image', description: 'Extra' },
      { url: 'https://example.com/other.webm', type: 'video', description: '' },
    ]);
  });

  it('handles video tags, missing sources, media limits, and extension-only detection', () => {
    expect(
      extractMedia({ content_html: '<img><video src="/v.MP4"></video>' }, feedUrl, 4)[0]?.type,
    ).toBe('video');
    expect(extractMedia({ image: '/x.png', banner_image: '/y.png' }, feedUrl, 1)).toHaveLength(1);
    expect(extractMedia({ image: '/x.png' }, feedUrl, 0)).toEqual([]);
  });
});

describe('feed fetching', () => {
  it('keeps healthy feeds when another feed fails', async () => {
    const options = config();
    options.feedUrls = ['https://one.example/feed', 'https://two.example/feed'];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [{ title: 'Hello' }] }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    const result = await new FeedProcessor(options, logger).fetchFeeds();
    expect(result.items).toHaveLength(1);
    expect(result.failedFeeds).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://one.example/feed');
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([new Response('invalid JSON'), Response.json({ nope: [] }), new Response('oversized')])(
    'reports invalid and oversized feeds',
    async (response) => {
      const options = { ...config(), maxFeedBytes: 3 };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
      expect(await new FeedProcessor(options, logger).fetchFeeds()).toEqual({
        items: [],
        failedFeeds: 1,
      });
    },
  );
});

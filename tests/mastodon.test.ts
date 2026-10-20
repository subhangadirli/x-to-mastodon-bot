import { describe, expect, it, vi } from 'vitest';
import { MastodonClient, formatStatus } from '../src/mastodon.js';
import { config, item } from './helpers.js';

describe('status formatting', () => {
  it('retains the original source link', () => {
    expect(formatStatus(item(), 500)).toBe('A post\n\n🔗 https://example.com/post');
  });

  it('uses content when no title exists', () => {
    expect(formatStatus(item({ title: '', url: '' }), 500)).toBe('Post content');
  });

  it('truncates by Unicode code points without splitting emoji', () => {
    const result = formatStatus(item({ title: '😀'.repeat(50), url: '' }), 10);
    expect(result).toBe('😀'.repeat(9) + '…');
    expect(Array.from(result)).toHaveLength(10);
  });

  it('reserves room for the complete source URL', () => {
    const result = formatStatus(item({ title: 'a'.repeat(100) }), 40);
    expect(Array.from(result)).toHaveLength(40);
    expect(result.endsWith('https://example.com/post')).toBe(true);
  });

  it('falls back to text when a source URL cannot fit', () => {
    expect(formatStatus(item({ url: 'https://example.com/' + 'x'.repeat(500) }), 40)).toBe(
      'A post',
    );
    expect(formatStatus(item({ title: 'long', url: '' }), 0)).toBe('');
  });
});

describe('Mastodon API client', () => {
  it('verifies credentials and sends authenticated, idempotent status requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'account-id', username: 'test' }))
      .mockResolvedValueOnce(Response.json({ id: 'status-id' }));
    const client = new MastodonClient(config());
    await client.verifyCredentials();
    await client.postStatus(item(), ['media-id']);
    const request = fetchMock.mock.calls[1]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(request.url).toBe('https://mastodon.example/api/v1/statuses');
    const headers = request.headers;
    expect(headers.get('authorization')).toBe('Bearer test-token');
    expect(headers.get('idempotency-key')).toBe('test-item');
    expect(await request.json()).toMatchObject({
      status: 'A post\n\n🔗 https://example.com/post',
      media_ids: ['media-id'],
      visibility: 'public',
    });
  });

  it('supports statuses without media', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ id: 'status' }));
    await new MastodonClient(config()).postStatus(item(), []);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request');
    expect(await request.text()).not.toContain('media_ids');
  });

  it('rejects empty statuses without issuing a request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(
      new MastodonClient(config()).postStatus(item({ title: '', content: '', url: '' }), []),
    ).rejects.toThrow('empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['Alt text', ''])(
    'uploads media and waits for processing (description: %s)',
    async (description) => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('fake image', { headers: { 'Content-Type': 'image/png; charset=binary' } }),
        )
        .mockResolvedValueOnce(Response.json({ id: 'media-id' }))
        .mockResolvedValueOnce(
          Response.json({ id: 'media-id', url: 'https://mastodon.example/image.png' }),
        );
      const result = await new MastodonClient(config()).uploadMedia({
        url: 'https://example.com/image.png',
        type: 'image',
        description,
      });
      expect(result).toBe('media-id');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const request = fetchMock.mock.calls[1]?.[0];
      if (!(request instanceof Request)) throw new Error('Expected a Request');
      const form = await request.formData();
      expect(form.get('description')).toBe(description || null);
      expect(form.get('file')).toBeInstanceOf(Blob);
    },
  );

  it.each([undefined, 'text/html'])(
    'rejects responses that are not media: %s',
    async (contentType) => {
      const headers = contentType ? { 'Content-Type': contentType } : {};
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Uint8Array([1]), { headers }),
      );
      await expect(
        new MastodonClient(config()).uploadMedia({
          url: 'https://example.com/image',
          type: 'image',
          description: '',
        }),
      ).rejects.toThrow('content type');
    },
  );

  it('does not upload oversized downloads', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('too long', { headers: { 'Content-Type': 'image/png' } }));
    await expect(
      new MastodonClient({ ...config(), maxMediaBytes: 2 }).uploadMedia({
        url: 'https://example.com/image',
        type: 'image',
        description: '',
      }),
    ).rejects.toThrow('byte limit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

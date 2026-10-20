import { MastoHttpError, MastoTimeoutError } from 'masto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isRetryable, readLimitedBody, retry } from '../src/http.js';

afterEach(() => vi.useRealTimers());

describe('bounded response reading', () => {
  it('reads valid bodies', async () => {
    expect(new TextDecoder().decode(await readLimitedBody(new Response('hello'), 5))).toBe('hello');
  });

  it('rejects HTTP errors', async () => {
    await expect(readLimitedBody(new Response('no', { status: 403 }), 10)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('enforces declared and actual size limits', async () => {
    await expect(
      readLimitedBody(new Response('a', { headers: { 'Content-Length': '100' } }), 10),
    ).rejects.toThrow('byte limit');
    await expect(readLimitedBody(new Response('too long'), 2)).rejects.toThrow('byte limit');
  });

  it('rejects absent and empty bodies', async () => {
    await expect(readLimitedBody(new Response(null), 10)).rejects.toThrow('Empty');
    await expect(readLimitedBody(new Response(''), 10)).rejects.toThrow('Empty');
  });
});

describe('retry policy', () => {
  it.each([408, 429, 500, 503])('retries transient HTTP %s', (status) => {
    expect(isRetryable(new HttpError(status))).toBe(true);
    expect(isRetryable(new MastoHttpError({ statusCode: status, message: 'Error' }))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry permanent HTTP %s', (status) => {
    expect(isRetryable(new HttpError(status))).toBe(false);
  });

  it('recognizes network failures and timeouts, not programming errors', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryable(new DOMException('Timed out', 'TimeoutError'))).toBe(true);
    expect(isRetryable(new MastoTimeoutError())).toBe(true);
    expect(isRetryable(new Error('Broken'))).toBe(false);
    expect(isRetryable(new TypeError('bad property access'))).toBe(false);
  });

  it('retries a transient failure and returns the successful result', async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new HttpError(503))
      .mockResolvedValue('ok');
    const result = retry(operation, 2);
    await vi.runAllTimersAsync();
    expect(await result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent failures', async () => {
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(new HttpError(401));
    await expect(retry(operation, 3)).rejects.toThrow('401');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

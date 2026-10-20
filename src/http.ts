import pRetry from 'p-retry';
import { MastoHttpError, MastoTimeoutError } from 'masto';

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP request failed (${status})`);
    this.name = 'HttpError';
  }
}

export function isRetryable(error: Error): boolean {
  if (error instanceof HttpError || error instanceof MastoHttpError) {
    const status = error instanceof HttpError ? error.status : error.statusCode;
    return status === 408 || status === 429 || status >= 500;
  }
  return (
    error instanceof MastoTimeoutError ||
    error.name === 'TimeoutError' ||
    (error instanceof TypeError && /fetch failed|network|terminated/i.test(error.message))
  );
}

export function retry<T>(operation: () => Promise<T>, retries: number): Promise<T> {
  return pRetry(operation, {
    retries,
    minTimeout: 1_000,
    maxTimeout: 30_000,
    randomize: true,
    shouldRetry: ({ error }) => isRetryable(error),
  });
}

/** Enforce limits while streaming, including when Content-Length is absent or misleading. */
export async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status);
  }
  const advertisedSize = Number(response.headers.get('content-length'));
  if (advertisedSize > maxBytes) {
    await response.body?.cancel();
    throw new Error('Response exceeds configured byte limit');
  }
  if (!response.body) throw new Error('Empty response body');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('Response exceeds configured byte limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error('Empty response body');
  return Buffer.concat(chunks, size);
}

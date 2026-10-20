import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncDatabase } from '../src/database.js';
import { Synchronizer } from '../src/synchronizer.js';
import type { FeedResult } from '../src/types.js';
import { config, item, logger, temporaryState } from './helpers.js';

describe('synchronizer', () => {
  let state: Awaited<ReturnType<typeof temporaryState>>;
  beforeEach(async () => {
    state = await temporaryState();
  });
  afterEach(async () => {
    await state.cleanup();
    vi.useRealTimers();
  });

  function setup(items = [item()], failedFeeds = 0) {
    const db = new SyncDatabase(state.path);
    const feed = {
      fetchFeeds: vi.fn<() => Promise<FeedResult>>().mockResolvedValue({ items, failedFeeds }),
    };
    const publisher = {
      verifyCredentials: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      uploadMedia: vi.fn<() => Promise<string>>().mockResolvedValue('media-id'),
      postStatus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const options = config();
    return {
      db,
      feed,
      publisher,
      options,
      sync: new Synchronizer(options, db, feed, publisher, logger),
    };
  }

  it('initializes state and verifies credentials', async () => {
    const { sync, publisher } = setup();
    await sync.init();
    expect(publisher.verifyCredentials).toHaveBeenCalledTimes(1);
  });

  it('filters posted items before applying the limit, then drains the backlog oldest first', async () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({ id: String(index), publishedAt: index }),
    );
    const { sync, db, publisher, options } = setup(items.reverse());
    options.maxPostsPerCheck = 2;
    await sync.init();
    await db.markAsPosted('7');
    expect(await sync.sync()).toMatchObject({ posted: 2 });
    expect(publisher.postStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: '0' }),
      [],
    );
    expect(publisher.postStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: '1' }),
      [],
    );
    expect(await sync.sync()).toMatchObject({ posted: 2 });
    expect(db.isPosted('2')).toBe(true);
    expect(db.isPosted('3')).toBe(true);
  });

  it('deduplicates overlapping feeds and never reposts persisted IDs', async () => {
    const { sync, publisher } = setup([item(), item()]);
    await sync.init();
    await sync.sync();
    expect(await sync.sync()).toMatchObject({ posted: 0 });
    expect(publisher.postStatus).toHaveBeenCalledTimes(1);
  });

  it('shares concurrent sync calls', async () => {
    const { sync, publisher, feed } = setup();
    await sync.init();
    const first = sync.sync();
    const second = sync.sync();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(feed.fetchFeeds).toHaveBeenCalledTimes(1);
    expect(publisher.postStatus).toHaveBeenCalledTimes(1);
  });

  it('records uploaded media and continues if another attachment fails', async () => {
    const media = { url: 'https://example.com/image.png', type: 'image' as const, description: '' };
    const { sync, publisher, db } = setup([item({ media: [media, media] })]);
    publisher.uploadMedia.mockRejectedValueOnce(new Error('failed'));
    await sync.init();
    expect(await sync.sync()).toMatchObject({ posted: 1 });
    expect(publisher.postStatus).toHaveBeenCalledWith(expect.anything(), ['media-id']);
    expect(db.getStats().mediaUploaded).toBe(1);
  });

  it('leaves failed statuses unposted so a later run can retry', async () => {
    const { sync, publisher, db } = setup();
    publisher.postStatus.mockRejectedValueOnce(new Error('temporary failure'));
    await sync.init();
    expect(await sync.sync()).toMatchObject({ failed: 1, posted: 0 });
    expect(db.isPosted('test-item')).toBe(false);
    expect(db.getStats().failed).toBe(1);
    expect(await sync.sync()).toMatchObject({ failed: 0, posted: 1 });
  });

  it('reports feed failures while processing healthy feeds', async () => {
    const { sync } = setup([item()], 1);
    await sync.init();
    expect(await sync.sync()).toEqual({ posted: 1, failed: 0, failedFeeds: 1 });
  });

  it('stops immediately if recording a successful post fails', async () => {
    const { sync, publisher, db } = setup([item(), item({ id: 'second' })]);
    await sync.init();
    vi.spyOn(db, 'markAsPosted').mockRejectedValue(new Error('disk full'));
    await expect(sync.sync()).rejects.toThrow('disk full');
    expect(publisher.postStatus).toHaveBeenCalledTimes(1);
  });

  it('waits between successful posts', async () => {
    const { sync, options } = setup([item(), item({ id: 'second' })]);
    options.postDelayMs = 1;
    await sync.init();
    expect(await sync.sync()).toMatchObject({ posted: 2 });
  });

  it('finishes the active run on shutdown without starting another cycle', async () => {
    const { sync, publisher } = setup();
    const controller = new AbortController();
    publisher.postStatus.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve();
    });
    await sync.init();
    await sync.start(controller.signal);
    expect(publisher.postStatus).toHaveBeenCalledTimes(1);
  });

  it('cancels the polling wait promptly on shutdown', async () => {
    const { sync } = setup([]);
    const controller = new AbortController();
    await sync.init();
    const listener = vi.spyOn(controller.signal, 'addEventListener');
    const running = sync.start(controller.signal);
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });
    controller.abort();
    await running;
  });

  it('does nothing when already stopped', async () => {
    const { sync, feed } = setup();
    await sync.start(AbortSignal.abort());
    expect(feed.fetchFeeds).not.toHaveBeenCalled();
  });

  it('stops the polling loop on fatal errors', async () => {
    const { sync, feed } = setup();
    feed.fetchFeeds.mockRejectedValue(new Error('fatal error'));
    await expect(sync.start(new AbortController().signal)).rejects.toThrow('Sync failed');
  });
});

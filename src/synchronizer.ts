import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { SyncDatabase } from './database.js';
import type { FeedResult, Publisher, SyncSummary } from './types.js';

interface FeedSource {
  fetchFeeds(): Promise<FeedResult>;
}

export class Synchronizer {
  private active: Promise<SyncSummary> | undefined;

  constructor(
    private readonly config: Config,
    private readonly db: SyncDatabase,
    private readonly feed: FeedSource,
    private readonly publisher: Publisher,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
    await this.db.init();
    await this.publisher.verifyCredentials();
  }

  /** Concurrent callers share the active run; they cannot publish the same item in parallel. */
  sync(): Promise<SyncSummary> {
    this.active ??= this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  async start(signal: AbortSignal): Promise<void> {
    const stopped = () => signal.aborted;
    while (!stopped()) {
      try {
        await this.sync();
      } catch {
        // A persistence failure must stop the bot, not risk duplicate posts in another cycle.
        this.logger.error('Sync could not complete; stopping to protect persisted state');
        throw new Error('Sync failed');
      }
      if (stopped()) break;
      try {
        await sleep(this.config.checkIntervalMs, undefined, { signal });
      } catch (error) {
        if (!stopped()) throw error;
      }
    }
  }

  private async run(): Promise<SyncSummary> {
    const { items, failedFeeds } = await this.feed.fetchFeeds();
    const unique = new Map(items.map((item) => [item.id, item]));
    const pending = [...unique.values()]
      .filter((item) => !this.db.isPosted(item.id))
      .sort((a, b) => a.publishedAt - b.publishedAt)
      .slice(0, this.config.maxPostsPerCheck);
    const summary: SyncSummary = { posted: 0, failed: 0, failedFeeds };

    for (const [index, item] of pending.entries()) {
      const mediaIds: string[] = [];
      for (const media of item.media) {
        try {
          mediaIds.push(await this.publisher.uploadMedia(media));
        } catch {
          this.logger.warn(
            { itemId: item.id },
            'Media upload failed; continuing without attachment',
          );
        }
      }
      try {
        await this.publisher.postStatus(item, mediaIds);
      } catch {
        summary.failed++;
        await this.db.incrementFailed();
        this.logger.error({ itemId: item.id }, 'Status publication failed');
        continue;
      }
      // Never swallow a state write error after publishing: stop before more external changes.
      await this.db.markAsPosted(item.id, mediaIds.length);
      summary.posted++;
      if (index < pending.length - 1 && this.config.postDelayMs > 0) {
        await sleep(this.config.postDelayMs);
      }
    }
    this.logger.info({ ...summary, stats: this.db.getStats() }, 'Sync completed');
    return summary;
  }
}

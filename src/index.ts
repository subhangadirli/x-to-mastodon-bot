import 'dotenv/config';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { SyncDatabase } from './database.js';
import { FeedProcessor } from './feed.js';
import { MastodonClient } from './mastodon.js';
import { Synchronizer } from './synchronizer.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const synchronizer = new Synchronizer(
    config,
    new SyncDatabase(config.statePath),
    new FeedProcessor(config, logger),
    new MastodonClient(config),
    logger,
  );
  const controller = new AbortController();
  const shutdown = () => {
    logger.info('Shutdown requested; finishing the active sync');
    controller.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await synchronizer.init();
    if (config.once) {
      const summary = await synchronizer.sync();
      if (summary.failed > 0 || summary.failedFeeds > 0) process.exitCode = 1;
    } else {
      await synchronizer.start(controller.signal);
    }
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

try {
  await main();
} catch (error) {
  // Library errors may embed request URLs or credentials; only configuration errors are safe.
  const message =
    error instanceof Error && /^(Invalid configuration|Unknown argument)/.test(error.message)
      ? error.message
      : 'Bot stopped after an initialization or sync failure. Check configuration and state.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

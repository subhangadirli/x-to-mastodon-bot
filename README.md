# X to Mastodon Sync Bot

Mirror posts from one or more [JSON Feeds](https://www.jsonfeed.org/) to Mastodon, including images and videos. An X-to-JSON-Feed service such as [RSS.app](https://rss.app) supplies the source; this bot does not use the X API directly or parse XML RSS.

![Banner](./assets/banner.png)

## Features

- Strict TypeScript with runtime validation of configuration, feeds, and saved state.
- Multiple feeds, duplicate filtering, and oldest-first processing of unseen posts.
- Images and videos from JSON Feed attachments, images, and embedded HTML, with available alt text.
- Timeouts, bounded downloads, and exponential retries for transient network/API failures.
- Persistent item history, atomic state writes, and Mastodon idempotency keys on status requests.
- One-shot or continuous operation, graceful shutdown, structured JSON logs, and sync statistics.
- Automated tests, coverage thresholds, linting, formatting, CI, and dependency updates.

## Quick start

Requires **Node.js 24+** (24 LTS recommended) and **pnpm 10**. The exact pnpm version is pinned in `package.json`; use Corepack if available or [install pnpm](https://pnpm.io/installation).

```sh
git clone https://github.com/subhangadirli/x-to-mastodon-bot.git
cd x-to-mastodon-bot
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env`:

```dotenv
FEED_URLS=https://rss.app/feeds/v1.1/your-feed.json
MASTODON_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=your_token_here
```

For multiple feeds, separate URLs with commas. In Mastodon, create an application under **Preferences → Development → New application**. Grant `read:accounts`, `write:statuses`, and `write:media`, then copy its access token. Never commit `.env` or tokens.

```sh
pnpm build
pnpm start --once  # One sync, then exit
pnpm start         # Continuous polling
```

**The first run publishes the oldest available posts**, up to five per check by default. Review your feed before starting: subsequent runs drain the remaining backlog. Publication is real; there is no dry-run mode.

## Configuration

All settings are environment variables. `.env` is loaded automatically without overriding existing environment values. Invalid settings fail before network requests.

| Variable                | Default                   | Purpose                                                          |
| ----------------------- | ------------------------- | ---------------------------------------------------------------- |
| `FEED_URLS`             | Required                  | Comma- or whitespace-separated HTTP(S) JSON Feed URLs            |
| `MASTODON_ACCESS_TOKEN` | Required                  | Mastodon application token                                       |
| `MASTODON_URL`          | `https://mastodon.social` | Mastodon instance URL                                            |
| `MASTODON_VISIBILITY`   | `public`                  | `public`, `unlisted`, `private`, or `direct`                     |
| `CHECK_INTERVAL_MS`     | `900000`                  | Delay between completed syncs (15 minutes)                       |
| `MAX_POSTS_PER_CHECK`   | `5`                       | Maximum unseen items attempted per sync                          |
| `MAX_STATUS_LENGTH`     | `500`                     | Conservative status limit, counted in Unicode code points        |
| `MAX_MEDIA_ATTACHMENTS` | `4`                       | Attachment limit; `0` disables media                             |
| `REQUEST_TIMEOUT_MS`    | `30000`                   | Feed and individual Mastodon request timeout                     |
| `MEDIA_TIMEOUT_MS`      | `60000`                   | Media download / server-side processing timeout                  |
| `MAX_MEDIA_BYTES`       | `41943040`                | Maximum download size per attachment (40 MiB)                    |
| `MAX_FEED_BYTES`        | `5242880`                 | Maximum feed download size (5 MiB)                               |
| `RETRY_ATTEMPTS`        | `3`                       | Additional attempts for transient failures; `0` disables retries |
| `POST_DELAY_MS`         | `3000`                    | Delay between successful posts                                   |
| `STATE_PATH`            | `./sync_state.json`       | Persistent JSON state file                                       |
| `LOG_LEVEL`             | `info`                    | Pino level, including `debug` and `silent`                       |

`--once` or `CI=true` selects one-shot operation. A feed or status failure gives one-shot runs a nonzero exit code, after saving any successful work. A failed attachment is logged and the status is still attempted with remaining media. Authentication and state persistence failures stop the bot.

Status text uses the title, falling back to plain text or decoded HTML. The source link is appended when it fits; text is truncated without splitting Unicode surrogate pairs. Instance limits and accepted media formats vary: adjust limits for your server. Invalid publication dates sort before dated items.

### State and duplicate protection

Keep `sync_state.json` on persistent storage and **run only one bot process per state file/account**. In-process calls cannot overlap, but separate processes are not coordinated. Item IDs are retained indefinitely to avoid reposting old feed entries; state grows with the number of posts. Counters track successful statuses, failed status attempts, and attachments included in successful statuses.

The existing state format and item-ID hashing remain compatible with the JavaScript version. Back up the state before upgrading. Corrupt state is never silently reset. Deleting state can replay your feed. Mastodon idempotency keys reduce duplicates after ambiguous API failures but have server-defined retention; they are not an exactly-once guarantee after a crash or state loss.

Only use trusted feed providers and media sources: the bot fetches URLs supplied by feeds, including redirects. Do not expose it as a service that accepts arbitrary feed URLs.

## GitHub Actions deployment

Add repository **Actions secrets**:

- `FEED_URLS`
- `MASTODON_URL` (set it explicitly, e.g. `https://mastodon.social`)
- `MASTODON_ACCESS_TOKEN`

Enable workflows, then use **Actions → X to Mastodon Sync → Run workflow** on the default branch. Scheduled runs are requested every five minutes; GitHub may delay or skip them. Scheduled workflows in forks may need enabling, and inactive repositories may have schedules disabled by GitHub.

The workflow serializes runs and restores the latest saved state, then saves with a **new cache key** even after a partial failure. It also attempts to restore the legacy `sync-state` cache when upgrading. The sync job only runs from the default branch to prevent branch-specific state from replaying posts.

**Actions caches are best-effort, not durable storage.** Cache eviction or an interrupted run before saving state can cause reposts. Back up state regularly; for reliable long-term deployment, run on a host with a persistent state volume rather than relying on Actions caches. Do not run local and Actions deployments against the same account independently.

## Development

```sh
pnpm dev             # Watch TypeScript sources
pnpm typecheck       # Strict compiler checks
pnpm lint            # Type-aware ESLint
pnpm format          # Apply Prettier formatting
pnpm test            # Tests (mocked APIs / local fixtures; no live account needed)
pnpm test:coverage   # V8 coverage with enforced thresholds
pnpm check           # All checks, coverage, and production build
pnpm audit --prod    # Production dependency advisory check
```

CI runs the full checks on Node.js 24 and 26. Dependabot proposes weekly package and pinned GitHub Actions updates. TypeScript stays on the newest release supported by the type-aware ESLint parser rather than accepting incompatible compiler upgrades.

```text
src/
  config.ts        Validated environment configuration
  database.ts      Atomic persistent state and statistics
  feed.ts          JSON Feed fetching, parsing, HTML, and media
  http.ts          Bounded response reading and retry policy
  index.ts         CLI entry point and shutdown handling
  mastodon.ts      Status formatting and Mastodon API integration
  synchronizer.ts  Deduplication, ordering, and polling
  types.ts         Shared application interfaces
tests/             Unit, regression, and CLI tests
```

### Upgrading from the JavaScript version

1. Back up `sync_state.json` and stop the old process.
2. Install Node.js 24+ and run `pnpm install --frozen-lockfile`.
3. Move hardcoded `CONFIG.feed.url` values into `FEED_URLS` in `.env` (or Actions secrets).
4. Run `pnpm check`, then use `pnpm start --once` instead of `node index.js --once`.
5. Keep using the same state path; do not delete the state file.

## Troubleshooting

- **Invalid configuration:** check the named variables against `.env.example`; feed URLs must be HTTP(S).
- **Feed failures:** open the JSON feed privately and confirm an `items` array exists. XML RSS is not supported. Check provider availability and download limits.
- **Authentication failure:** verify the instance URL, token, and scopes above.
- **Missing attachments:** check content types, file sizes, and your Mastodon instance limits. Audio and non-media attachments are ignored.
- **State failure:** check permissions, disk space, and state validity. Restore a backup rather than deleting state.
- **Repeated posts:** verify persistent state is being restored and that no second deployment is running.

Logs intentionally omit raw request URLs, credentials, and upstream error bodies because RSS URLs can contain private keys.

## License

[GPL-3.0-only](LICENSE).

[Follow the maintainer on Mastodon](https://mastodon.social/@subhanqedirli).

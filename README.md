<div align="center">

# 🔄 X to Mastodon Sync Bot

**Bring your posts home to the fediverse.**

Automatically mirror posts from one or more JSON Feeds to Mastodon—with images, videos, and duplicate protection.

[![CI](https://github.com/subhangadirli/x-to-mastodon-bot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/subhangadirli/x-to-mastodon-bot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Mastodon](https://img.shields.io/badge/Mastodon-API%20v2-6364FF?logo=mastodon&logoColor=white)](https://joinmastodon.org/)
[![License](https://img.shields.io/github/license/subhangadirli/x-to-mastodon-bot?color=blue)](LICENSE)

<br />

![X to Mastodon Bot banner](./assets/banner.png)

[Get started](#-quick-start) · [Configure](#️-configuration) · [Deploy](#️-github-actions) · [Contribute](#️-development)

</div>

---

## ✨ Features

|                             |                                                                |
| --------------------------- | -------------------------------------------------------------- |
| 🔄 **Multi-feed sync**      | Mirror one or more JSON Feeds, oldest unseen posts first.      |
| 🖼️ **Rich media**           | Bring along images and videos, including available alt text.   |
| 🛡️ **Duplicate protection** | Persistent post history, plus Mastodon idempotency keys.       |
| ♻️ **Resilient by design**  | Timeouts, bounded downloads, and retries for transient errors. |
| 📊 **Know what happened**   | Structured logs, saved statistics, and detailed test coverage. |
| ☁️ **Deploy your way**      | Run once, poll continuously, or schedule with GitHub Actions.  |

> **Heads up:** The first run publishes the oldest posts in your feed—up to five per check by default. Review your feed first. This bot publishes real posts; it has no dry-run mode.

## 🚀 Quick start

You’ll need **Node.js 24+** and **pnpm 10**. The pnpm version is pinned in `package.json`; install pnpm with [Corepack](https://pnpm.io/installation) or your preferred method.

```sh
git clone https://github.com/subhangadirli/x-to-mastodon-bot.git
cd x-to-mastodon-bot
pnpm install --frozen-lockfile
cp .env.example .env
```

Add your feed and Mastodon credentials to `.env`:

```dotenv
FEED_URLS=https://rss.app/feeds/v1.1/your-feed.json
MASTODON_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=your_token_here
```

Create an application in Mastodon under **Preferences → Development → New application**. Grant `read:accounts`, `write:statuses`, and `write:media`, then copy its access token. Never commit your `.env` file or token.

```sh
pnpm build
pnpm start --once  # Sync once and exit
pnpm start         # Keep syncing on an interval
```

For multiple feeds, separate URLs with commas or spaces. To create a feed from X, use a service such as [RSS.app](https://rss.app). This bot consumes **JSON Feed**; it does not use the X API directly or parse XML RSS.

## ⚙️ Configuration

Settings can be supplied in `.env` or through the environment. Existing environment variables take precedence. Invalid settings are rejected before the bot makes network requests.

| Variable                | Default                   | Description                                              |
| ----------------------- | ------------------------- | -------------------------------------------------------- |
| `FEED_URLS`             | — **required**            | Comma- or whitespace-separated HTTP(S) JSON Feed URLs    |
| `MASTODON_ACCESS_TOKEN` | — **required**            | Mastodon application token                               |
| `MASTODON_URL`          | `https://mastodon.social` | Mastodon instance URL                                    |
| `MASTODON_VISIBILITY`   | `public`                  | `public`, `unlisted`, `private`, or `direct`             |
| `CHECK_INTERVAL_MS`     | `900000`                  | Time between completed syncs (15 minutes)                |
| `MAX_POSTS_PER_CHECK`   | `5`                       | Unseen posts attempted per sync                          |
| `MAX_STATUS_LENGTH`     | `500`                     | Conservative status limit in Unicode code points         |
| `MAX_MEDIA_ATTACHMENTS` | `4`                       | Attachments per post; set to `0` to disable media        |
| `REQUEST_TIMEOUT_MS`    | `30000`                   | Feed and individual Mastodon request timeout             |
| `MEDIA_TIMEOUT_MS`      | `60000`                   | Media download and server processing timeout             |
| `MAX_MEDIA_BYTES`       | `41943040`                | Maximum size per media download (40 MiB)                 |
| `MAX_FEED_BYTES`        | `5242880`                 | Maximum feed download size (5 MiB)                       |
| `RETRY_ATTEMPTS`        | `3`                       | Extra tries for transient failures; `0` disables retries |
| `POST_DELAY_MS`         | `3000`                    | Pause between successful posts                           |
| `STATE_PATH`            | `./sync_state.json`       | Path to persistent JSON state                            |
| `LOG_LEVEL`             | `info`                    | Pino log level, including `debug` and `silent`           |

Use `pnpm start --once` or `CI=true pnpm start` to run once. Partial feed or post failures produce a nonzero exit code after successful work is saved. If an attachment fails, the status is still attempted with any other media. Authentication and state-write failures stop the bot.

The post title is preferred; plain text or text extracted from HTML is used as a fallback. The source link is appended when it fits. Text truncation respects Unicode characters. Mastodon limits vary by instance; adjust the settings accordingly.

## 🗃️ State & duplicate protection

Keep `sync_state.json` on persistent storage and run **only one bot process per account and state file**. Concurrent sync calls within one process are coordinated; separate processes are not. The history retains item IDs indefinitely, so the state file grows over time.

The TypeScript version reads the previous JavaScript state format and preserves existing item IDs. Back up your state before upgrading. Corrupt state is never silently reset; deleting the file can cause old posts to be published again. Mastodon idempotency keys help with ambiguous API failures, but cannot guarantee exactly-once posting after a crash or state loss.

Only use trusted feed providers and media sources. The bot fetches URLs supplied by feeds, including redirects; it is not intended as a service for arbitrary user-submitted feed URLs.

## ☁️ GitHub Actions

Add these **Actions repository secrets**:

| Secret                  | Value                                             |
| ----------------------- | ------------------------------------------------- |
| `FEED_URLS`             | One or more JSON Feed URLs                        |
| `MASTODON_URL`          | Your instance URL, e.g. `https://mastodon.social` |
| `MASTODON_ACCESS_TOKEN` | Your Mastodon application token                   |

Enable workflows, then run **Actions → X to Mastodon Sync → Run workflow** on the default branch. The schedule requests a run every five minutes, but GitHub may delay or skip scheduled runs.

Runs are serialized and the workflow restores and saves state using a fresh cache key. It can also restore the previous `sync-state` cache format. The sync job runs only on the default branch.

> **Cache caveat:** GitHub Actions caches are best-effort, not durable storage. Cache eviction or an interrupted save can cause reposts. For dependable long-term operation, use a host with a persistent state volume. Do not run two deployments against the same account independently.

## 🧑‍💻 Development

```sh
pnpm dev             # Watch TypeScript sources
pnpm typecheck       # Strict compiler checks
pnpm lint            # Type-aware ESLint
pnpm format          # Apply Prettier formatting
pnpm test            # Tests with mocked APIs and local fixtures
pnpm test:coverage   # Coverage report with enforced thresholds
pnpm check           # Run every check and build for production
pnpm audit --prod    # Audit production dependencies
```

CI runs on Node.js 24 and 26. Dependabot checks weekly for dependency and GitHub Actions updates.

<details>
<summary><strong>Project structure</strong></summary>

```text
src/
  config.ts        Validated environment configuration
  database.ts      Atomic persistent state and statistics
  feed.ts          JSON Feed fetching, HTML, and media parsing
  http.ts          Bounded response reading and retry policy
  index.ts         CLI entry point and shutdown handling
  mastodon.ts      Status formatting and Mastodon API integration
  synchronizer.ts  Deduplication, ordering, and polling
  types.ts         Shared application interfaces
tests/             Unit, regression, and CLI tests
```

</details>

<details>
<summary><strong>Upgrading from the JavaScript version</strong></summary>

1. Back up `sync_state.json` and stop the old process.
2. Install Node.js 24+ and run `pnpm install --frozen-lockfile`.
3. Move hardcoded `CONFIG.feed.url` values into `FEED_URLS` in `.env` or Actions secrets.
4. Run `pnpm check`; use `pnpm start --once` instead of `node index.js --once`.
5. Keep the existing state file and path—do not delete it.

</details>

## 🩺 Troubleshooting

| Problem                | What to check                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Invalid configuration  | Check the named variables in `.env.example`; feed URLs must use HTTP(S).                          |
| Feed unavailable       | Confirm the provider works and returns JSON Feed with an `items` array. XML RSS is not supported. |
| Authentication failure | Verify the instance URL, token, and application scopes.                                           |
| Missing media          | Check response content types, file size, and your instance’s media limits. Audio is ignored.      |
| State error            | Check disk space and file permissions. Restore a backup instead of deleting state.                |
| Duplicate posts        | Confirm state persists between runs and that only one deployment is active.                       |

Logs omit raw request URLs, credentials, and upstream response bodies because feed URLs may contain private keys.

## 📜 License

Distributed under the [GNU General Public License v3.0](LICENSE).

<div align="center">

### Enjoying the project?

[![Follow on Mastodon](https://img.shields.io/badge/Follow%20on-Mastodon-6364FF?logo=mastodon&logoColor=white)](https://mastodon.social/@subhanqedirli)

⭐ If this project is useful to you, consider giving it a star!

</div>

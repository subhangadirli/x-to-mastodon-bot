<div align="center">
<h1>🔄 X to Mastodon Sync Bot</h1>

Automatically sync your X (Twitter) posts to Mastodon. 

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org/) [![Mastodon](https://img.shields.io/badge/Mastodon-API%20v2-6364FF?style=flat-square&logo=mastodon)](https://joinmastodon.org/) [![License](https://img.shields.io/badge/License-GPL--3.0-blue?style=flat-square)](LICENSE) [![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-brightgreen.svg?style=flat-square)](https://github.com/USERNAME/x-to-mastodon-bot/graphs/commit-activity)

![Banner](./assets/banner.png)
</div>

## ✨ Features

- 🔄 **Auto sync** — New posts are automatically sent to Mastodon
- 🖼️ **Image support** — JPG, PNG, GIF, WebP, AVIF
- 🎬 **Video support** — MP4, WebM, MOV (up to 40MB)
- 🛡️ **Duplicate protection** — Same post is never shared twice
- ♻️ **Retry mechanism** — Failed operations are automatically retried
- 📊 **Statistics** — Track total posts, failures, and media uploads
- ⚡ **GitHub Actions** — Run for free without a server

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Mastodon account with API token
- RSS. app account (for X feed)

### 1. Clone the repository

```bash
git clone https://github.com/USERNAME/x-to-mastodon-bot.git
cd x-to-mastodon-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env`:

```bash
cp .env.example . env
```

Edit `.env` file: 

```env
MASTODON_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=your_access_token_here
```

### 4. Get Mastodon Token

1. Log in to your Mastodon account
2. Go to **Preferences** → **Development** → **New Application**
3. Enter a name (e.g., "X Sync Bot")
4. Select scopes: `read` and `write`
5. Click **Submit** → Copy the **Access Token**

### 5. Set Up RSS Feed

1. Go to [RSS.app](https://rss.app)
2. Paste your X (Twitter) profile URL
3. Copy the JSON feed link
4. Update `CONFIG.feed.url` in `index.js`

## 💻 Usage

### Run Locally

```bash
# Start the bot (continuous)
npm start

# Development mode (auto-reload)
npm run dev

# One-time sync
node index.js --once
```

### Example Output

```
═══════════════════════════════════
   X → MASTODON SYNC BOT
═══════════════════════════════════
[INFO] 🚀 Starting bot...
[INFO] 💾 Database loaded
[INFO] 🐘 Mastodon:  @username
[INFO] ✅ Bot ready! 
[INFO] 🔄 Sync started...
[INFO] 📡 Fetching feed...
[INFO] ✅ Feed loaded:  X Feed
[INFO] 📰 Found 5 items
[INFO] 📝 New:  This is a test post... 
[INFO] 📸 Found 1 media
[INFO] 📦 Media:  0. 45 MB
[INFO] ✅ Media uploaded:  123456789
[INFO] ✅ Post:  https://mastodon.social/@user/987654321
[INFO] 📊 New: 1 | Total: 1 | Failed: 0
```

## ☁️ Deploy with GitHub Actions

### 1. Add Secrets

Go to your repository:  **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | Value |
|------|-------|
| `MASTODON_URL` | `https://mastodon.social` |
| `MASTODON_ACCESS_TOKEN` | Your token |

### 2.  Automatic Sync

The workflow runs automatically: 

- ⏰ Every 5 minutes (scheduled)
- 🔘 Manual:  **Actions** → **X to Mastodon Sync** → **Run workflow**

## 📁 Project Structure

```
x-to-mastodon-bot/
├── . github/
│   └── workflows/
│       └── sync. yml          # GitHub Actions workflow
├── index.js                   # Main bot code
├── package. json               # NPM configuration
├── sync_state.json            # Sync state (auto-generated)
├── .env                       # Secret config (don't commit!)
├── .env.example               # Example config
├── . gitignore                 # Git ignore rules
└── README.md                  # This file
```

## ⚙️ Configuration

Customize the `CONFIG` object in `index.js`:

```javascript
const CONFIG = {
  feed: {
    url: 'https://rss.app/feeds/v1.1/XXXXX.json',  // RSS feed URL
    checkInterval:  2 * 60 * 1000,                   // Check interval (ms)
  },
  mastodon: {
    url: process.env. MASTODON_URL,                  // Mastodon instance
    accessToken: process.env. MASTODON_ACCESS_TOKEN, // API token
    visibility:  'public',                            // public/unlisted/private/direct
    maxStatusLength: 500,                            // Max text length
    maxMediaAttachments: 4,                          // Max media per post
  },
  sync: {
    maxPostsPerCheck: 5,                             // Max posts per check
    historySize: 100,                                // Posts to remember
    retryAttempts: 3,                                // Retry count
    mediaUploadTimeout: 60000,                       // Media timeout (ms)
  },
};
```

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the bot (continuous) |
| `npm run dev` | Development mode |
| `node index.js --once` | One-time sync |

## 📋 Mastodon Limits

| Parameter | Limit |
|-----------|-------|
| Max video size | 40 MB |
| Video formats | MP4, WebM, MOV |
| Image formats | JPG, PNG, GIF, WebP, AVIF |
| Max media per post | 4 |

## 🐛 Troubleshooting

### Feed not loading (404)

- Verify the feed is active on RSS.app
- Check if the URL is correct

### Mastodon error (401)

- Verify your access token is correct
- Ensure the token has `read` and `write` permissions

### Media not uploading

- Check file size (40MB limit for videos)
- Ensure media URL points directly to the file

### GitHub Actions not running

- Verify secrets are correctly added
- Check error messages in the Actions tab

## 📜 License

GPL v3 — feel free to use however you like!

## 🤝 Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feature/new-feature`)
3. Commit changes (`git commit -m 'Add new feature'`)
4. Push to branch (`git push origin feature/new-feature`)
5. Open a Pull Request


---

⭐ If you like this project, don't forget to give it a star! 

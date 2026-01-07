import 'dotenv/config';
import { createRestAPIClient } from 'masto';
import { createHash } from 'crypto';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import pRetry from 'p-retry';
import pino from 'pino';
import { existsSync, writeFileSync } from 'fs';

// ═══════════════════════════════════════════════════════════════
// 📋 KONFİQURASİYA
// ═══════════════════════════════════════════════════════════════

const isCI = process.env. CI === 'true' || process.argv.includes('--once');

const CONFIG = {
  feed: {
    url: 'https://rss.app/feeds/v1.1/HoeTCauPEPrGkHB9. json',
    checkInterval: 2 * 60 * 1000,
  },
  mastodon: {
    url: process. env.MASTODON_URL || 'https://mastodon.social',
    accessToken:  process.env. MASTODON_ACCESS_TOKEN,
    visibility: 'public',
    maxStatusLength: 500,
    maxMediaAttachments: 4,
  },
  sync: {
    maxPostsPerCheck: 5,
    historySize: 100,
    retryAttempts: 3,
    mediaUploadTimeout: 60000,
  },
  db: {
    path: './sync_state.json',
  },
};

// ═══════════════════════════════════════════════════════════════
// 📝 LOGGER
// ═══════════════════════════════════════════════════════════════

const logger = pino({
  transport: isCI ? undefined : {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// ═══════════════════════════════════════════════���═══════════════
// 💾 VERİTABANI
// ═══════════════════════════════════════════════════════════════

class SyncDatabase {
  constructor(filePath) {
    this.db = null;
    this. filePath = filePath;
  }

  async init() {
    // Fayl yoxdursa yarat
    if (!existsSync(this. filePath)) {
      writeFileSync(this.filePath, JSON.stringify({
        postedItems: [],
        lastSync: null,
        stats: { total: 0, failed: 0, mediaUploaded: 0 },
      }));
    }

    const adapter = new JSONFile(this.filePath);
    this.db = new Low(adapter, {
      postedItems: [],
      lastSync: null,
      stats:  { total: 0, failed: 0, mediaUploaded: 0 },
    });
    await this.db.read();
    logger.info('💾 Veritabanı yükləndi');
  }

  async isPosted(itemId) {
    return this.db.data.postedItems. includes(itemId);
  }

  async markAsPosted(itemId) {
    this. db.data.postedItems. unshift(itemId);
    if (this.db. data.postedItems.length > CONFIG. sync.historySize) {
      this.db. data.postedItems = this.db.data.postedItems. slice(0, CONFIG.sync. historySize);
    }
    this.db.data.stats.total++;
    this.db.data.lastSync = new Date().toISOString();
    await this. db.write();
  }

  async incrementFailed() {
    this.db.data.stats.failed++;
    await this.db.write();
  }

  async incrementMediaUploaded(count = 1) {
    this.db. data.stats.mediaUploaded += count;
    await this.db.write();
  }

  getStats() {
    return this.db.data. stats;
  }
}

// ═══════════════════════════════════════════════════════════════
// 🌐 JSON FEED İŞLƏYİCİ
// ═══════════════════════════════════════════════════════════════

class FeedProcessor {
  constructor(feedUrl) {
    this. feedUrl = feedUrl;
  }

  async fetchFeed() {
    logger.info(`📡 Feed yüklənir: ${this.feedUrl}`);

    const response = await fetch(this.feedUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, application/feed+json, */*',
        'User-Agent': 'Mozilla/5.0 (compatible; MastodonSyncBot/1.0)',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response. ok) {
      throw new Error(`Feed yüklənmədi: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    logger.info(`✅ Feed yükləndi: ${data.title || 'Adsız feed'}`);
    return data;
  }

  extractMedia(item) {
    const media = [];

    if (item.image) {
      media.push({
        url: item.image,
        type: this.detectMediaType(item. image),
        description: '',
      });
    }

    if (item.banner_image && item.banner_image !== item.image) {
      media.push({
        url:  item.banner_image,
        type:  this.detectMediaType(item.banner_image),
        description: '',
      });
    }

    if (item.attachments && Array.isArray(item.attachments)) {
      for (const attachment of item.attachments) {
        if (attachment.url && ! media.some(m => m.url === attachment.url)) {
          media.push({
            url:  attachment.url,
            type: attachment. mime_type || this.detectMediaType(attachment.url),
            description: attachment. title || '',
          });
        }
      }
    }

    if (item.content_html) {
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let match;
      while ((match = imgRegex.exec(item. content_html)) !== null) {
        const imgUrl = match[1];
        if (!media.some(m => m.url === imgUrl)) {
          media.push({ url: imgUrl, type: 'image', description: '' });
        }
      }

      const videoRegex = /<video[^>]+src=["']([^"']+)["'][^>]*>/gi;
      while ((match = videoRegex.exec(item. content_html)) !== null) {
        const videoUrl = match[1];
        if (!media.some(m => m. url === videoUrl)) {
          media. push({ url: videoUrl, type: 'video', description:  '' });
        }
      }
    }

    return media. slice(0, CONFIG.mastodon.maxMediaAttachments);
  }

  detectMediaType(url) {
    if (! url) return 'unknown';
    const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'];
    const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];

    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (url.includes('video') || url.includes('mp4')) return 'video';
    if (url.includes('image') || url.includes('photo') || url.includes('pbs. twimg.com')) return 'image';

    return 'image';
  }

  generateItemId(item) {
    const identifier = item.id || item.url || item.title || JSON.stringify(item);
    return createHash('sha256').update(identifier).digest('hex').slice(0, 16);
  }

  parseItems(feed) {
    if (!feed. items || ! Array.isArray(feed.items)) {
      logger.warn('⚠️ Feed-də items tapılmadı');
      return [];
    }

    return feed.items.map(item => ({
      id: this.generateItemId(item),
      title: item.title || '',
      content: item.content_text || this.stripHtml(item. content_html) || '',
      url: item.url || item.external_url || '',
      media: this.extractMedia(item),
      publishedAt: item. date_published ?  new Date(item. date_published) : new Date(),
      author: item.authors?.[0]?.name || item.author?. name || feed.title || '',
    }));
  }

  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ═══════════════════════════════════════════════════════════════
// 🐘 MASTODON KLİENT
// ═══════════════════════════════════════════════════════════════

class MastodonClient {
  constructor() {
    this. client = createRestAPIClient({
      url: CONFIG.mastodon.url,
      accessToken: CONFIG.mastodon. accessToken,
    });
  }

  async verifyCredentials() {
    try {
      const account = await this.client.v1.accounts.verifyCredentials();
      logger.info(`🐘 Mastodon:  @${account.username}`);
      return account;
    } catch (error) {
      throw new Error(`Mastodon təsdiqləmə uğursuz: ${error. message}`);
    }
  }

  async uploadMedia(mediaItem) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.sync.mediaUploadTimeout);

    try {
      logger. info(`📤 Media yüklənir... `);

      const response = await fetch(mediaItem.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MastodonSyncBot/1.0)' },
      });

      if (!response.ok) {
        throw new Error(`Media əldə edilmədi: ${response. status}`);
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) {
        throw new Error('Media faylı boşdur');
      }

      const sizeMB = buffer.length / (1024 * 1024);
      logger.info(`📦 Media:  ${sizeMB. toFixed(2)} MB`);

      // Video ölçü limiti
      if (mediaItem.type === 'video' && sizeMB > 40) {
        logger. warn(`⚠️ Video çox böyükdür (${sizeMB.toFixed(2)} MB), atlayırıq`);
        return null;
      }

      const blob = new Blob([buffer], { type:  contentType });

      const attachment = await this.client.v2.media.create({
        file: blob,
        description:  mediaItem.description?. slice(0, 1500) || undefined,
      });

      logger.info(`✅ Media yükləndi:  ${attachment.id}`);
      return attachment;
    } catch (error) {
      if (error. name === 'AbortError') {
        throw new Error('Media timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async uploadMediaWithRetry(mediaItem) {
    return pRetry(() => this.uploadMedia(mediaItem), {
      retries:  CONFIG.sync.retryAttempts,
      onFailedAttempt: (error) => {
        logger.warn(`⚠️ Retry ${error.attemptNumber}/${CONFIG.sync.retryAttempts}:  ${error.message}`);
      },
    });
  }

  formatStatus(item) {
    const maxLength = CONFIG.mastodon. maxStatusLength;
    let status = item.title || item.content || '';
    const urlSuffix = item.url ?  `\n\n🔗 ${item.url}` : '';
    const availableLength = maxLength - urlSuffix.length;

    if (status.length > availableLength) {
      status = status. slice(0, availableLength - 3) + '...';
    }

    return status + urlSuffix;
  }

  async postStatus(item, mediaIds = []) {
    const params = {
      status: this.formatStatus(item),
      visibility: CONFIG.mastodon. visibility,
    };

    if (mediaIds.length > 0) {
      params.mediaIds = mediaIds;
    }

    return await this.client.v1.statuses.create(params);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔄 SİNXRONİZATOR
// ═══════════════════════════════════════════════════════════════

class Synchronizer {
  constructor() {
    this. db = new SyncDatabase(CONFIG.db.path);
    this.feed = new FeedProcessor(CONFIG.feed. url);
    this.mastodon = new MastodonClient();
  }

  async init() {
    logger.info('🚀 Bot başladılır.. .');
    await this.db.init();
    await this.mastodon.verifyCredentials();
    logger.info('✅ Bot hazırdır! ');
  }

  async syncItem(item) {
    const mediaIds = [];

    if (item.media. length > 0) {
      logger.info(`📸 ${item.media.length} media tapıldı`);

      for (const mediaItem of item.media) {
        try {
          if (mediaItem.type === 'image' || mediaItem.type === 'video') {
            const attachment = await this. mastodon.uploadMediaWithRetry(mediaItem);
            if (attachment) {
              mediaIds.push(attachment.id);
              await this.db.incrementMediaUploaded();
            }
          }
        } catch (error) {
          logger.error(`❌ Media xətası:  ${error.message}`);
        }
      }
    }

    const result = await this.mastodon.postStatus(item, mediaIds);
    logger.info(`✅ Post:  ${result.url}`);
    return result;
  }

  async sync() {
    logger.info('🔄 Sinxronizasiya başladı...');

    try {
      const feedData = await this.feed.fetchFeed();
      const items = this.feed.parseItems(feedData);

      logger.info(`📰 ${items.length} element tapıldı`);

      if (items.length === 0) return;

      const sortedItems = items
        .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
        .slice(-CONFIG.sync.maxPostsPerCheck);

      let newPosts = 0;

      for (const item of sortedItems) {
        if (await this.db.isPosted(item.id)) continue;

        try {
          logger.info(`📝 Yeni:  ${item.title?. slice(0, 50) || 'Başlıqsız'}...`);
          await this.syncItem(item);
          await this.db.markAsPosted(item.id);
          newPosts++;
          await new Promise(r => setTimeout(r, 3000));
        } catch (error) {
          logger.error(`❌ Xəta: ${error.message}`);
          await this.db. incrementFailed();
        }
      }

      const stats = this.db.getStats();
      logger.info(`📊 Yeni:  ${newPosts} | Ümumi: ${stats. total} | Uğursuz: ${stats.failed}`);

    } catch (error) {
      logger. error(`❌ Sinxronizasiya xətası: ${error. message}`);
    }
  }

  start() {
    this.sync();
    setInterval(() => this.sync(), CONFIG.feed.checkInterval);
    logger.info(`⏰ Dövri:  hər ${CONFIG.feed.checkInterval / 1000}s`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🎯 ƏSAS PROQRAM
// ═══════════════════════════════════════════════════════════════

async function main() {
  logger.info('═══════════════════════════════════');
  logger.info('   X → MASTODON SYNC BOT');
  logger.info('═══════════════════════════════════');

  const sync = new Synchronizer();

  try {
    await sync.init();

    if (isCI) {
      // GitHub Actions:  bir dəfə işlə və çıx
      await sync.sync();
      logger.info('✅ CI sync tamamlandı');
      process.exit(0);
    } else {
      // Lokal: davamlı işlə
      sync.start();

      process.on('SIGINT', () => {
        logger.info('\n👋 Bot dayandırılır.. .');
        process.exit(0);
      });
    }
  } catch (error) {
    logger.error(`❌ Kritik xəta: ${error.message}`);
    process.exit(1);
  }
}

main();
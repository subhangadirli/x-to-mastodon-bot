export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  description: string;
}

export interface FeedItem {
  id: string;
  title: string;
  content: string;
  url: string;
  media: MediaItem[];
  publishedAt: number;
  author: string;
}

export interface FeedResult {
  items: FeedItem[];
  failedFeeds: number;
}

export interface Publisher {
  verifyCredentials(): Promise<void>;
  uploadMedia(item: MediaItem): Promise<string>;
  postStatus(item: FeedItem, mediaIds: string[]): Promise<void>;
}

export interface SyncSummary {
  posted: number;
  failed: number;
  failedFeeds: number;
}

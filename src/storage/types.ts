import type { AccessTokenInfo, MediaInfo, WechatConfig } from '../mcp-tool/types.js';

/**
 * HTTP-only runtime storage interface.
 * Cloudflare Workers uses D1StorageManager; local SQLite storage has been removed.
 */
export interface StorageManager {
  initialize(): Promise<void>;
  saveConfig(config: WechatConfig): Promise<void>;
  getConfig(): Promise<WechatConfig | null>;
  clearConfig(): Promise<void>;
  saveAccessToken(tokenInfo: AccessTokenInfo): Promise<void>;
  getAccessToken(): Promise<AccessTokenInfo | null>;
  clearAccessToken(): Promise<void>;
  saveMedia(media: MediaInfo): Promise<void>;
  getMedia(mediaId: string): Promise<MediaInfo | null>;
  listMedia(type?: string): Promise<MediaInfo[]>;
  close(): Promise<void>;
}

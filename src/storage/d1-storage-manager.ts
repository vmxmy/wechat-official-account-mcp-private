import CryptoJS from 'crypto-js';
import type { AccessTokenInfo, MediaInfo, WechatConfig } from '../mcp-tool/types.js';
import type { StorageManager } from './types.js';

export type D1Value = string | number | boolean | null | ArrayBuffer | Uint8Array;

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: {
    changes?: number;
  };
}

export interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  exec?(query: string): Promise<unknown>;
}

export interface SecretStoreBindingLike {
  get(): Promise<string | null>;
}

export type D1SecretKeySource =
  | string
  | null
  | undefined
  | SecretStoreBindingLike
  | (() => string | null | undefined | Promise<string | null | undefined>);

/**
 * Cloudflare D1 存储管理器。
 *
 * 表结构由 D1 migration 管理；本类实现 HTTP-only Workers 运行时所需的 CRUD 语义。
 */
export class D1StorageManager implements StorageManager {
  private secretKey: string | null = null;

  constructor(
    private readonly db: D1DatabaseLike,
    private readonly secretKeySource?: D1SecretKeySource,
  ) {}

  async initialize(): Promise<void> {
    this.secretKey = await this.resolveSecretKey();
  }

  async saveConfig(config: WechatConfig): Promise<void> {
    const now = Date.now();
    await this.db.prepare(
      `INSERT OR REPLACE INTO config (id, app_id, app_secret, token, encoding_aes_key, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      config.appId,
      this.encryptValue(config.appSecret),
      this.encryptValue(config.token ?? null),
      this.encryptValue(config.encodingAESKey ?? null),
      now,
      now,
    ).run();
  }

  async getConfig(): Promise<WechatConfig | null> {
    const row = await this.db.prepare('SELECT * FROM config WHERE id = 1').first<{
      app_id: string;
      app_secret: string;
      token?: string | null;
      encoding_aes_key?: string | null;
    }>();

    if (!row) return null;

    return {
      appId: row.app_id,
      appSecret: this.decryptValue(row.app_secret) ?? row.app_secret,
      token: this.decryptValue(row.token) ?? row.token ?? undefined,
      encodingAESKey: this.decryptValue(row.encoding_aes_key) ?? row.encoding_aes_key ?? undefined,
    };
  }

  async clearConfig(): Promise<void> {
    await this.db.prepare('DELETE FROM config WHERE id = 1').run();
  }

  async saveAccessToken(tokenInfo: AccessTokenInfo): Promise<void> {
    await this.db.prepare('DELETE FROM access_tokens').run();
    await this.db.prepare(
      'INSERT INTO access_tokens (access_token, expires_in, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).bind(
      this.encryptValue(tokenInfo.accessToken),
      tokenInfo.expiresIn,
      tokenInfo.expiresAt,
      Date.now(),
    ).run();
  }

  async getAccessToken(): Promise<AccessTokenInfo | null> {
    const row = await this.db.prepare('SELECT * FROM access_tokens ORDER BY created_at DESC LIMIT 1').first<{
      access_token: string;
      expires_in: number;
      expires_at: number;
    }>();

    if (!row) return null;

    return {
      accessToken: this.decryptValue(row.access_token) ?? row.access_token,
      expiresIn: row.expires_in,
      expiresAt: row.expires_at,
    };
  }

  async clearAccessToken(): Promise<void> {
    await this.db.prepare('DELETE FROM access_tokens').run();
  }

  async saveMedia(media: MediaInfo): Promise<void> {
    await this.db.prepare(
      'INSERT OR REPLACE INTO media (media_id, type, created_at, url) VALUES (?, ?, ?, ?)',
    ).bind(media.mediaId, media.type, media.createdAt, media.url ?? null).run();
  }

  async getMedia(mediaId: string): Promise<MediaInfo | null> {
    const row = await this.db.prepare('SELECT * FROM media WHERE media_id = ?').bind(mediaId).first<{
      media_id: string;
      type: string;
      created_at: number;
      url?: string | null;
    }>();

    if (!row) return null;

    return this.toMediaInfo(row);
  }

  async listMedia(type?: string): Promise<MediaInfo[]> {
    const statement = type
      ? this.db.prepare('SELECT * FROM media WHERE type = ? ORDER BY created_at DESC').bind(type)
      : this.db.prepare('SELECT * FROM media ORDER BY created_at DESC');
    const result = await statement.all<{
      media_id: string;
      type: string;
      created_at: number;
      url?: string | null;
    }>();

    return (result.results ?? []).map(row => this.toMediaInfo(row));
  }

  async close(): Promise<void> {
    // D1 连接由 Workers runtime 管理，无需关闭。
  }

  private toMediaInfo(row: {
    media_id: string;
    type: string;
    created_at: number;
    url?: string | null;
  }): MediaInfo {
    return {
      mediaId: row.media_id,
      type: row.type as MediaInfo['type'],
      createdAt: row.created_at,
      url: row.url as MediaInfo['url'],
    };
  }

  private async resolveSecretKey(): Promise<string | null> {
    const source = this.secretKeySource;
    if (!source) return null;

    if (typeof source === 'string') return source;
    if (typeof source === 'function') return await source() ?? null;
    return await source.get() ?? null;
  }

  private encryptValue(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!this.secretKey) return value;
    const cipher = CryptoJS.AES.encrypt(value, this.secretKey).toString();
    return `enc:${cipher}`;
  }

  private decryptValue(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!this.secretKey) return value;
    if (!value.startsWith('enc:')) return value;
    const cipher = value.slice(4);
    try {
      const bytes = CryptoJS.AES.decrypt(cipher, this.secretKey);
      const text = bytes.toString(CryptoJS.enc.Utf8);
      return text || null;
    } catch {
      return null;
    }
  }
}

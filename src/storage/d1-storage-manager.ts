import CryptoJS from 'crypto-js';
import type { AccessTokenInfo, MediaInfo, WechatConfig } from '../mcp-tool/types.js';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_SLUG,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG,
  type AccountConfigInput,
  type AccountContext,
  type BackfillDefaultAccountResult,
  type TenantAwareStorageManager,
  type WechatAccountRecord,
} from './types.js';

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
 * 新增的 tenant/account 方法只写入 additive multi-tenant 表，旧单租户表保留用于回滚兼容。
 */
export class D1StorageManager implements TenantAwareStorageManager {
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

  async backfillDefaultTenantAndAccount(): Promise<BackfillDefaultAccountResult> {
    const legacy = await this.getConfig();
    if (!legacy) {
      return {
        tenantId: DEFAULT_TENANT_ID,
        accountId: DEFAULT_ACCOUNT_ID,
        created: false,
        hasLegacyConfig: false,
      };
    }

    const now = Date.now();
    await this.db.prepare(
      `INSERT OR IGNORE INTO tenants (id, slug, name, status, default_account_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG, 'Default Tenant', DEFAULT_ACCOUNT_ID, now, now).run();
    await this.db.prepare(
      `INSERT OR IGNORE INTO users (id, email, display_name, status, created_at, updated_at)
       VALUES ('user_default_admin', NULL, 'Default Admin', 'active', ?, ?)`,
    ).bind(now, now).run();
    await this.db.prepare(
      `INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, scopes_json, default_account_id, status, created_at, updated_at)
       VALUES (?, 'user_default_admin', 'owner', '["woa:*"]', ?, 'active', ?, ?)`,
    ).bind(DEFAULT_TENANT_ID, DEFAULT_ACCOUNT_ID, now, now).run();
    await this.saveAccountConfig({
      tenantId: DEFAULT_TENANT_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      accountSlug: DEFAULT_ACCOUNT_SLUG,
      accountName: 'Default WeChat Official Account',
      config: legacy,
      isDefault: true,
      status: 'active',
    });

    const token = await this.getAccessToken();
    if (token) {
      await this.saveAccountAccessToken(this.defaultAccountContext(legacy.appId), token);
    }

    return {
      tenantId: DEFAULT_TENANT_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      created: true,
      hasLegacyConfig: true,
    };
  }

  async getDefaultAccountContext(): Promise<AccountContext | null> {
    const row = await this.db.prepare(
      `SELECT
         a.id AS account_id,
         a.slug AS account_slug,
         a.name AS account_name,
         a.app_id AS app_id,
         a.status AS account_status,
         t.id AS tenant_id,
         t.slug AS tenant_slug,
         t.name AS tenant_name
       FROM wechat_accounts a
       INNER JOIN tenants t ON t.id = a.tenant_id
       WHERE a.status != 'disabled'
       ORDER BY a.is_default DESC, a.created_at ASC
       LIMIT 1`,
    ).first<AccountContextRow>();

    if (row) return toAccountContext(row);

    const legacy = await this.getConfig();
    return legacy ? this.defaultAccountContext(legacy.appId) : null;
  }

  async getAccountContext(tenantId: string, accountId: string): Promise<AccountContext | null> {
    const row = await this.db.prepare(
      `SELECT
         a.id AS account_id,
         a.slug AS account_slug,
         a.name AS account_name,
         a.app_id AS app_id,
         a.status AS account_status,
         t.id AS tenant_id,
         t.slug AS tenant_slug,
         t.name AS tenant_name
       FROM wechat_accounts a
       INNER JOIN tenants t ON t.id = a.tenant_id
       WHERE a.tenant_id = ? AND a.id = ? AND a.status != 'disabled'
       LIMIT 1`,
    ).bind(tenantId, accountId).first<AccountContextRow>();

    if (row) return toAccountContext(row);

    if (tenantId === DEFAULT_TENANT_ID && accountId === DEFAULT_ACCOUNT_ID) {
      const legacy = await this.getConfig();
      return legacy ? this.defaultAccountContext(legacy.appId) : null;
    }

    return null;
  }

  async listAccountsForTenant(tenantId: string): Promise<WechatAccountRecord[]> {
    const result = await this.db.prepare(
      `SELECT
         a.id AS account_id,
         a.slug AS account_slug,
         a.name AS account_name,
         a.app_id AS app_id,
         a.app_secret AS app_secret,
         a.webhook_token AS webhook_token,
         a.encoding_aes_key AS encoding_aes_key,
         a.status AS account_status,
         a.is_default AS is_default,
         a.created_at AS created_at,
         a.updated_at AS updated_at,
         t.id AS tenant_id,
         t.slug AS tenant_slug,
         t.name AS tenant_name
       FROM wechat_accounts a
       INNER JOIN tenants t ON t.id = a.tenant_id
       WHERE a.tenant_id = ?
       ORDER BY a.is_default DESC, a.created_at ASC`,
    ).bind(tenantId).all<AccountRow>();

    return (result.results ?? []).map(row => ({
      ...toAccountContext(row),
      hasAppSecret: !!row.app_secret,
      hasWebhookToken: !!row.webhook_token,
      hasEncodingAESKey: !!row.encoding_aes_key,
      isDefault: Number(row.is_default ?? 0) === 1,
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? 0),
    }));
  }

  async saveAccountConfig(input: AccountConfigInput): Promise<void> {
    const now = Date.now();
    await this.db.prepare(
      `INSERT INTO wechat_accounts (
         id,
         tenant_id,
         slug,
         name,
         app_id,
         app_secret,
         webhook_token,
         encoding_aes_key,
         status,
         is_default,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         slug = excluded.slug,
         name = excluded.name,
         app_id = excluded.app_id,
         app_secret = excluded.app_secret,
         webhook_token = excluded.webhook_token,
         encoding_aes_key = excluded.encoding_aes_key,
         status = excluded.status,
         is_default = excluded.is_default,
         updated_at = excluded.updated_at`,
    ).bind(
      input.accountId,
      input.tenantId,
      input.accountSlug ?? input.accountId,
      input.accountName ?? input.accountId,
      input.config.appId,
      this.encryptValue(input.config.appSecret),
      this.encryptValue(input.config.token ?? null),
      this.encryptValue(input.config.encodingAESKey ?? null),
      input.status ?? 'active',
      input.isDefault ? 1 : 0,
      now,
      now,
    ).run();
  }

  async getAccountConfig(context: AccountContext): Promise<WechatConfig | null> {
    const row = await this.db.prepare(
      `SELECT app_id, app_secret, webhook_token, encoding_aes_key
       FROM wechat_accounts
       WHERE tenant_id = ? AND id = ? AND status != 'disabled'
       LIMIT 1`,
    ).bind(context.tenantId, context.accountId).first<{
      app_id?: string | null;
      app_secret?: string | null;
      webhook_token?: string | null;
      encoding_aes_key?: string | null;
    }>();

    if (row?.app_id && row.app_secret) {
      return {
        appId: row.app_id,
        appSecret: this.decryptValue(row.app_secret) ?? row.app_secret,
        token: this.decryptValue(row.webhook_token) ?? row.webhook_token ?? undefined,
        encodingAESKey: this.decryptValue(row.encoding_aes_key) ?? row.encoding_aes_key ?? undefined,
      };
    }

    if (isDefaultAccount(context)) {
      return await this.getConfig();
    }

    return null;
  }

  async clearAccountConfig(context: AccountContext): Promise<void> {
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET app_id = NULL,
           app_secret = NULL,
           webhook_token = NULL,
           encoding_aes_key = NULL,
           updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
    ).bind(Date.now(), context.tenantId, context.accountId).run();

    if (isDefaultAccount(context)) {
      await this.clearConfig();
    }
  }

  async saveAccountAccessToken(context: AccountContext, tokenInfo: AccessTokenInfo): Promise<void> {
    const now = Date.now();
    await this.db.prepare(
      `INSERT INTO wechat_access_tokens (tenant_id, account_id, access_token, expires_in, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, account_id) DO UPDATE SET
         access_token = excluded.access_token,
         expires_in = excluded.expires_in,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    ).bind(
      context.tenantId,
      context.accountId,
      this.encryptValue(tokenInfo.accessToken),
      tokenInfo.expiresIn,
      tokenInfo.expiresAt,
      now,
      now,
    ).run();
  }

  async getAccountAccessToken(context: AccountContext): Promise<AccessTokenInfo | null> {
    const row = await this.db.prepare(
      `SELECT access_token, expires_in, expires_at
       FROM wechat_access_tokens
       WHERE tenant_id = ? AND account_id = ?
       LIMIT 1`,
    ).bind(context.tenantId, context.accountId).first<{
      access_token: string;
      expires_in: number;
      expires_at: number;
    }>();

    if (row) {
      return {
        accessToken: this.decryptValue(row.access_token) ?? row.access_token,
        expiresIn: row.expires_in,
        expiresAt: row.expires_at,
      };
    }

    if (isDefaultAccount(context)) {
      return await this.getAccessToken();
    }

    return null;
  }

  async clearAccountAccessToken(context: AccountContext): Promise<void> {
    await this.db.prepare('DELETE FROM wechat_access_tokens WHERE tenant_id = ? AND account_id = ?')
      .bind(context.tenantId, context.accountId)
      .run();

    if (isDefaultAccount(context)) {
      await this.clearAccessToken();
    }
  }

  async saveAccountMedia(context: AccountContext, media: MediaInfo): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO account_media (tenant_id, account_id, media_id, type, created_at, url)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(context.tenantId, context.accountId, media.mediaId, media.type, media.createdAt, media.url ?? null).run();
  }

  async getAccountMedia(context: AccountContext, mediaId: string): Promise<MediaInfo | null> {
    const row = await this.db.prepare(
      `SELECT media_id, type, created_at, url
       FROM account_media
       WHERE tenant_id = ? AND account_id = ? AND media_id = ?`,
    ).bind(context.tenantId, context.accountId, mediaId).first<{
      media_id: string;
      type: string;
      created_at: number;
      url?: string | null;
    }>();

    if (row) return this.toMediaInfo(row);

    if (isDefaultAccount(context)) {
      return await this.getMedia(mediaId);
    }

    return null;
  }

  async listAccountMedia(context: AccountContext, type?: string): Promise<MediaInfo[]> {
    const statement = type
      ? this.db.prepare(
        `SELECT media_id, type, created_at, url
         FROM account_media
         WHERE tenant_id = ? AND account_id = ? AND type = ?
         ORDER BY created_at DESC`,
      ).bind(context.tenantId, context.accountId, type)
      : this.db.prepare(
        `SELECT media_id, type, created_at, url
         FROM account_media
         WHERE tenant_id = ? AND account_id = ?
         ORDER BY created_at DESC`,
      ).bind(context.tenantId, context.accountId);
    const result = await statement.all<{
      media_id: string;
      type: string;
      created_at: number;
      url?: string | null;
    }>();

    const scopedRows = (result.results ?? []).map(row => this.toMediaInfo(row));
    if (scopedRows.length === 0 && isDefaultAccount(context)) {
      return await this.listMedia(type);
    }

    return scopedRows;
  }

  namespaceR2Key(context: AccountContext, key: string): string {
    const normalized = key.replace(/^\/+/, '');
    return `tenants/${context.tenantId}/accounts/${context.accountId}/${normalized}`;
  }

  async close(): Promise<void> {
    // D1 连接由 Workers runtime 管理，无需关闭。
  }

  private defaultAccountContext(appId?: string): AccountContext {
    return {
      tenantId: DEFAULT_TENANT_ID,
      tenantSlug: DEFAULT_TENANT_SLUG,
      tenantName: 'Default Tenant',
      accountId: DEFAULT_ACCOUNT_ID,
      accountSlug: DEFAULT_ACCOUNT_SLUG,
      accountName: 'Default WeChat Official Account',
      appId,
      status: 'active',
      role: 'owner',
      scopes: ['woa:*'],
    };
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

type AccountContextRow = {
  tenant_id: string;
  tenant_slug?: string | null;
  tenant_name?: string | null;
  account_id: string;
  account_slug?: string | null;
  account_name?: string | null;
  app_id?: string | null;
  account_status?: string | null;
};

type AccountRow = AccountContextRow & {
  app_secret?: string | null;
  webhook_token?: string | null;
  encoding_aes_key?: string | null;
  is_default?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
};

function toAccountContext(row: AccountContextRow): AccountContext {
  return {
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug ?? undefined,
    tenantName: row.tenant_name ?? undefined,
    accountId: row.account_id,
    accountSlug: row.account_slug ?? undefined,
    accountName: row.account_name ?? undefined,
    appId: row.app_id ?? undefined,
    status: row.account_status ?? undefined,
  };
}

function isDefaultAccount(context: AccountContext): boolean {
  return context.tenantId === DEFAULT_TENANT_ID && context.accountId === DEFAULT_ACCOUNT_ID;
}

import type { AccessTokenInfo, MediaInfo, WechatConfig } from '../mcp-tool/types.js';

export const DEFAULT_TENANT_ID = 'tenant_default';
export const DEFAULT_TENANT_SLUG = 'default';
export const DEFAULT_ACCOUNT_ID = 'acct_default';
export const DEFAULT_ACCOUNT_SLUG = 'default';

export type TenantRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type OAuthScope = string;
export type AccountStatus = 'active' | 'disabled' | 'pending';

export interface TenantContext {
  tenantId: string;
  tenantSlug?: string;
  tenantName?: string;
  role?: TenantRole;
  scopes?: OAuthScope[];
}

export interface AccountContext extends TenantContext {
  accountId: string;
  accountSlug?: string;
  accountName?: string;
  appId?: string;
  status?: AccountStatus | string;
}

export interface WechatAccountRecord extends AccountContext {
  appId?: string;
  hasAppSecret: boolean;
  hasWebhookToken: boolean;
  hasEncodingAESKey: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccountConfigInput {
  tenantId: string;
  accountId: string;
  accountSlug?: string;
  accountName?: string;
  config: WechatConfig;
  isDefault?: boolean;
  status?: AccountStatus | string;
}

export interface BackfillDefaultAccountResult {
  tenantId: string;
  accountId: string;
  created: boolean;
  hasLegacyConfig: boolean;
}

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

/**
 * New tenant-aware storage operations used by the Workers multi-tenant runtime.
 * The legacy StorageManager methods stay available for default-account rollback compatibility.
 */
export interface TenantAwareStorageManager extends StorageManager {
  backfillDefaultTenantAndAccount(): Promise<BackfillDefaultAccountResult>;
  getDefaultAccountContext(): Promise<AccountContext | null>;
  getAccountContext(tenantId: string, accountId: string): Promise<AccountContext | null>;
  listAccountsForTenant(tenantId: string): Promise<WechatAccountRecord[]>;
  saveAccountConfig(input: AccountConfigInput): Promise<void>;
  getAccountConfig(context: AccountContext): Promise<WechatConfig | null>;
  clearAccountConfig(context: AccountContext): Promise<void>;
  saveAccountAccessToken(context: AccountContext, tokenInfo: AccessTokenInfo): Promise<void>;
  getAccountAccessToken(context: AccountContext): Promise<AccessTokenInfo | null>;
  clearAccountAccessToken(context: AccountContext): Promise<void>;
  saveAccountMedia(context: AccountContext, media: MediaInfo): Promise<void>;
  getAccountMedia(context: AccountContext, mediaId: string): Promise<MediaInfo | null>;
  listAccountMedia(context: AccountContext, type?: string): Promise<MediaInfo[]>;
  namespaceR2Key(context: AccountContext, key: string): string;
}

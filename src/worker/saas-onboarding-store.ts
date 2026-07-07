import CryptoJS from 'crypto-js';
import type { AccessTokenInfo, WechatConfig } from '../mcp-tool/types.js';
import type { D1DatabaseLike, D1Value, SecretStoreBindingLike } from '../storage/d1-storage-manager.js';
import type { AccountSummary, TenantRequestContext, TenantRole, TenantSummary } from './tenant-context.js';
import {
  DEFAULT_SUBSCRIPTION_PLAN,
  PLAN_QUOTA_POLICIES,
  normalizeSubscriptionPlan,
  type SubscriptionPlan,
} from './quota-policy.js';

export type SaasSecretKeySource = string | null | undefined | SecretStoreBindingLike | (() => string | null | undefined | Promise<string | null | undefined>);
export type IdentityProvider = 'email' | 'github' | string;
export type EmailCodeVerifyFailure = 'not_found' | 'expired' | 'attempt_limit' | 'invalid_code';
export type WechatResourceStatus = 'unconfigured' | 'active' | 'locked' | 'disabled' | string;

export interface OperatorRecord {
  operatorId: string;
  verifiedEmail: string;
  displayName?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmailCodeIssueResult {
  codeId: string;
  email: string;
  expiresAt: number;
  maxAttempts: number;
}

export type EmailCodeVerifyResult =
  | { ok: true; operator: OperatorRecord; codeId: string }
  | { ok: false; reason: EmailCodeVerifyFailure; attemptsRemaining?: number };

export interface WebSessionRecord {
  sessionId: string;
  operatorId: string;
  expiresAt: number;
  revokedAt?: number | null;
}

export interface SecuritySessionRecord {
  id: string;
  kind: 'web' | 'oauth';
  clientName: string;
  clientId?: string;
  createdAt: number;
  lastSeenAt?: number;
  expiresAt: number;
  revokedAt?: number | null;
  canRevoke: boolean;
}

export interface OAuthClientInput {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  clientType?: 'public' | 'confidential' | string;
  tenantId?: string | null;
  secretHash?: string | null;
  now?: number;
}

export interface OAuthTokenSessionInput {
  operatorId: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
  now?: number;
}

export interface BootstrapTenantResult {
  created: boolean;
  tenant: TenantSummary;
  resource: AccountSummary;
}

export interface WechatResourceRecord extends AccountSummary {
  hasAppSecret: boolean;
  hasWebhookToken: boolean;
  hasEncodingAESKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWechatResourceInput {
  tenantId: string;
  name?: string | null;
  slug?: string | null;
  resourceId?: string | null;
  now?: number;
}

export interface ConfigureWechatCredentialsInput {
  tenantId: string;
  resourceId: string;
  config: WechatConfig;
  tokenInfo?: AccessTokenInfo | null;
  now?: number;
}

export interface ValidateAndPersistCredentialsInput extends ConfigureWechatCredentialsInput {
  validate: (config: WechatConfig) => Promise<AccessTokenInfo | null | undefined>;
}

export interface PlanLimitDetails {
  code: 'account_allowance_exceeded';
  tenantId: string;
  plan: SubscriptionPlan;
  limit: number;
  used: number;
  remaining: number;
  upgrade: {
    webUrl: string;
    cliCommand: string;
    guidance: string;
  };
}

export class AccountAllowanceError extends Error {
  readonly code = 'account_allowance_exceeded';

  constructor(public readonly details: PlanLimitDetails) {
    super(`Account allowance exceeded for ${details.plan}: ${details.used}/${details.limit}.`);
    this.name = 'AccountAllowanceError';
  }
}

export class DuplicateAppIdError extends Error {
  readonly code = 'duplicate_app_id';

  constructor(public readonly appId: string) {
    super(`WeChat AppID ${appId} is already assigned to another active resource.`);
    this.name = 'DuplicateAppIdError';
  }
}

export const SAAS_ONBOARDING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  verified_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_identities (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  verified_email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS operator_email_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  ip_hash TEXT,
  provider_subject TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS oauth_consents (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scopes_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE(operator_id, client_id, scopes_hash),
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS oauth_token_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS public_signup_rate_limits (
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(bucket, key_hash, window_start)
);
CREATE TABLE IF NOT EXISTS tenant_owners (
  tenant_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start INTEGER,
  current_period_end INTEGER,
  limits_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL DEFAULT '[]',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  tenant_id TEXT,
  secret_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS r2_media_retention_metadata (
  object_key TEXT PRIMARY KEY,
  tenant_id TEXT,
  account_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS inbound_message_retention_metadata (
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  oldest_retained_at INTEGER,
  purge_before INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(tenant_id, account_id)
);
CREATE TABLE IF NOT EXISTS monitoring_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  tenant_id TEXT,
  account_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS operator_deletion_requests (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_at INTEGER NOT NULL,
  completed_at INTEGER,
  support_note TEXT,
  FOREIGN KEY(operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_operator_email_codes_email ON operator_email_codes(email, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_operator_identities_operator ON operator_identities(operator_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_operator ON web_sessions(operator_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_token_sessions_operator ON oauth_token_sessions(operator_id, revoked_at, refresh_expires_at);
CREATE INDEX IF NOT EXISTS idx_public_signup_rate_limits_reset ON public_signup_rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS idx_tenant_owners_operator ON tenant_owners(operator_id);
CREATE INDEX IF NOT EXISTS idx_r2_media_retention_expires ON r2_media_retention_metadata(expires_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_type_time ON monitoring_events(event_type, created_at);
`;

const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const ACCOUNT_ALLOWANCES: Record<SubscriptionPlan, number> = {
  free: 1,
  plus: 3,
  pro: 10,
};

export class D1SaasOnboardingStore {
  private schemaReady = false;
  private secretKey: string | null = null;

  constructor(
    private readonly db: D1DatabaseLike,
    private readonly secretKeySource?: SaasSecretKeySource,
  ) {}

  async ensureSchema(): Promise<void> {
    if (!this.secretKey) {
      this.secretKey = await this.resolveSecretKey();
    }
    if (this.schemaReady) return;

    for (const statement of SAAS_ONBOARDING_SCHEMA_SQL.split(';').map(part => part.trim()).filter(Boolean)) {
      await this.db.prepare(statement).run();
    }
    this.schemaReady = true;
  }

  async findOperatorByEmail(email: string): Promise<OperatorRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT id, verified_email, display_name, status, created_at, updated_at
       FROM operators
       WHERE verified_email = ? AND status != 'disabled'
       LIMIT 1`,
    ).bind(normalizeEmail(email)).first<Record<string, unknown>>();
    if (!row) return null;
    const operator = rowToOperator(row);
    await this.ensureLegacyUserForOperator(operator);
    return operator;
  }

  async createOrResolveOperatorByEmail(input: {
    email: string;
    displayName?: string | null;
    operatorId?: string | null;
    now?: number;
  }): Promise<{ operator: OperatorRecord; created: boolean }> {
    await this.ensureSchema();
    const email = normalizeEmail(input.email);
    const existing = await this.findOperatorByEmail(email);
    if (existing) {
      return { operator: existing, created: false };
    }

    const now = input.now ?? Date.now();
    const operatorId = input.operatorId || opaqueId('op');
    await this.db.prepare(
      `INSERT INTO operators (id, verified_email, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).bind(operatorId, email, input.displayName ?? email, now, now).run();
    await this.linkOperatorIdentity({
      operatorId,
      provider: 'email',
      providerSubject: email,
      verifiedEmail: email,
      now,
    });

    const operator = await this.findOperatorByEmail(email);
    if (!operator) {
      throw new Error('Failed to create Operator identity.');
    }
    return { operator, created: true };
  }

  async findOperatorByProviderSubject(provider: IdentityProvider, providerSubject: string): Promise<OperatorRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT o.id, o.verified_email, o.display_name, o.status, o.created_at, o.updated_at
       FROM operator_identities i
       INNER JOIN operators o ON o.id = i.operator_id
       WHERE i.provider = ? AND i.provider_subject = ? AND o.status != 'disabled'
       LIMIT 1`,
    ).bind(provider, providerSubject).first<Record<string, unknown>>();
    if (!row) return null;
    const operator = rowToOperator(row);
    await this.ensureLegacyUserForOperator(operator);
    return operator;
  }

  async linkOperatorIdentity(input: {
    operatorId: string;
    provider: IdentityProvider;
    providerSubject: string;
    verifiedEmail?: string | null;
    identityId?: string | null;
    now?: number;
  }): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const operator = await this.findOperatorById(input.operatorId);
    if (operator) {
      await this.ensureLegacyUserForOperator({
        ...operator,
        verifiedEmail: input.verifiedEmail ? normalizeEmail(input.verifiedEmail) : operator.verifiedEmail,
      }, now);
    }
    await this.db.prepare(
      `INSERT INTO operator_identities (
         id,
         operator_id,
         provider,
         provider_subject,
         verified_email,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_subject) DO UPDATE SET
         operator_id = excluded.operator_id,
         verified_email = excluded.verified_email,
         updated_at = excluded.updated_at`,
    ).bind(
      input.identityId || opaqueId('oid'),
      input.operatorId,
      input.provider,
      input.providerSubject,
      input.verifiedEmail ? normalizeEmail(input.verifiedEmail) : null,
      now,
      now,
    ).run();
  }

  async issueEmailCode(input: {
    email: string;
    code: string;
    purpose?: string | null;
    ip?: string | null;
    providerSubject?: string | null;
    codeId?: string | null;
    now?: number;
  }): Promise<EmailCodeIssueResult> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const email = normalizeEmail(input.email);
    const codeId = input.codeId || opaqueId('code');
    await this.db.prepare(
      `INSERT INTO operator_email_codes (
         id,
         email,
         code_hash,
         purpose,
         attempts,
         max_attempts,
         issued_at,
         expires_at,
         consumed_at,
         ip_hash,
         provider_subject,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).bind(
      codeId,
      email,
      await hashText(`${email}:${input.code}`),
      input.purpose || 'login',
      EMAIL_CODE_MAX_ATTEMPTS,
      now,
      now + EMAIL_CODE_TTL_MS,
      input.ip ? await hashText(input.ip) : null,
      input.providerSubject ?? null,
      now,
      now,
    ).run();

    return {
      codeId,
      email,
      expiresAt: now + EMAIL_CODE_TTL_MS,
      maxAttempts: EMAIL_CODE_MAX_ATTEMPTS,
    };
  }

  async verifyEmailCode(input: {
    email: string;
    code: string;
    displayName?: string | null;
    now?: number;
  }): Promise<EmailCodeVerifyResult> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const email = normalizeEmail(input.email);
    const row = await this.db.prepare(
      `SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at
       FROM operator_email_codes
       WHERE email = ? AND consumed_at IS NULL
       ORDER BY issued_at DESC
       LIMIT 1`,
    ).bind(email).first<Record<string, unknown>>();

    if (!row) return { ok: false, reason: 'not_found' };

    const codeId = stringValue(row.id) || '';
    const attempts = numberValue(row.attempts) ?? 0;
    const maxAttempts = numberValue(row.max_attempts) ?? EMAIL_CODE_MAX_ATTEMPTS;
    const expiresAt = numberValue(row.expires_at) ?? 0;
    if (attempts >= maxAttempts) {
      await this.consumeEmailCode(codeId, now);
      return { ok: false, reason: 'attempt_limit', attemptsRemaining: 0 };
    }
    if (expiresAt <= now) {
      await this.consumeEmailCode(codeId, now);
      return { ok: false, reason: 'expired' };
    }

    const expectedHash = stringValue(row.code_hash);
    const actualHash = await hashText(`${email}:${input.code}`);
    if (expectedHash !== actualHash) {
      const nextAttempts = attempts + 1;
      await this.db.prepare(
        `UPDATE operator_email_codes
         SET attempts = ?, consumed_at = CASE WHEN ? >= max_attempts THEN ? ELSE consumed_at END, updated_at = ?
         WHERE id = ?`,
      ).bind(nextAttempts, nextAttempts, now, now, codeId).run();
      return {
        ok: false,
        reason: nextAttempts >= maxAttempts ? 'attempt_limit' : 'invalid_code',
        attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
      };
    }

    await this.consumeEmailCode(codeId, now);
    const { operator } = await this.createOrResolveOperatorByEmail({
      email,
      displayName: input.displayName,
      now,
    });
    return { ok: true, operator, codeId };
  }

  async recordRateLimitHit(input: {
    bucket: string;
    key: string;
    windowMs: number;
    limit: number;
    now?: number;
  }): Promise<{ allowed: boolean; count: number; resetAt: number; limit: number }> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const windowStart = Math.floor(now / input.windowMs) * input.windowMs;
    const resetAt = windowStart + input.windowMs;
    const keyHash = await hashText(input.key);
    const existing = await this.db.prepare(
      `SELECT count, reset_at
       FROM public_signup_rate_limits
       WHERE bucket = ? AND key_hash = ? AND window_start = ?
       LIMIT 1`,
    ).bind(input.bucket, keyHash, windowStart).first<Record<string, unknown>>();
    const count = (numberValue(existing?.count) ?? 0) + 1;

    await this.db.prepare(
      `INSERT INTO public_signup_rate_limits (bucket, key_hash, window_start, count, reset_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bucket, key_hash, window_start) DO UPDATE SET
         count = excluded.count,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at`,
    ).bind(input.bucket, keyHash, windowStart, count, resetAt, now, now).run();

    return { allowed: count <= input.limit, count, resetAt, limit: input.limit };
  }

  async createWebSession(input: {
    operatorId: string;
    sessionToken: string;
    sessionId?: string | null;
    now?: number;
  }): Promise<WebSessionRecord> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const sessionId = input.sessionId || opaqueId('sess');
    const expiresAt = now + WEB_SESSION_TTL_MS;
    await this.db.prepare(
      `INSERT INTO web_sessions (id, operator_id, session_hash, created_at, last_seen_at, updated_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(sessionId, input.operatorId, await hashText(input.sessionToken), now, now, now, expiresAt).run();
    return { sessionId, operatorId: input.operatorId, expiresAt, revokedAt: null };
  }

  async getWebSession(sessionToken: string, now: number = Date.now()): Promise<WebSessionRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT id, operator_id, expires_at, revoked_at
       FROM web_sessions
       WHERE session_hash = ? AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    ).bind(await hashText(sessionToken), now).first<Record<string, unknown>>();

    if (!row) return null;
    const session = rowToWebSession(row);
    const nextExpiresAt = now + WEB_SESSION_TTL_MS;
    await this.db.prepare(
      `UPDATE web_sessions
       SET last_seen_at = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, nextExpiresAt, now, session.sessionId).run();
    return { ...session, expiresAt: nextExpiresAt };
  }

  async revokeWebSession(sessionId: string, now: number = Date.now()): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare(
      `UPDATE web_sessions
       SET revoked_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, now, sessionId).run();
  }

  async registerOAuthClient(input: OAuthClientInput): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const redirectUris = normalizeStringList(input.redirectUris);
    if (!redirectUris.every(uri => isAllowedRedirectUri(uri))) {
      throw new Error('OAuth redirect URIs must be HTTPS or localhost callback URLs.');
    }
    await this.db.prepare(
      `INSERT INTO oauth_clients (
         client_id,
         client_name,
         client_type,
         redirect_uris_json,
         scopes_json,
         tenant_id,
         secret_hash,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         client_name = excluded.client_name,
         client_type = excluded.client_type,
         redirect_uris_json = excluded.redirect_uris_json,
         scopes_json = excluded.scopes_json,
         tenant_id = excluded.tenant_id,
         secret_hash = excluded.secret_hash,
         updated_at = excluded.updated_at`,
    ).bind(
      input.clientId,
      input.clientName,
      input.clientType ?? 'public',
      JSON.stringify(redirectUris),
      JSON.stringify(normalizeStringList(input.scopes)),
      input.tenantId ?? null,
      input.secretHash ?? null,
      now,
      now,
    ).run();
  }

  async rememberOAuthConsent(input: {
    operatorId: string;
    clientId: string;
    scopes: string[];
    consentId?: string | null;
    now?: number;
  }): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const scopes = normalizeStringList(input.scopes).sort();
    await this.db.prepare(
      `INSERT INTO oauth_consents (id, operator_id, client_id, scopes_hash, scopes_json, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(operator_id, client_id, scopes_hash) DO UPDATE SET
         scopes_json = excluded.scopes_json,
         revoked_at = NULL,
         updated_at = excluded.updated_at`,
    ).bind(
      input.consentId || opaqueId('consent'),
      input.operatorId,
      input.clientId,
      await hashText(scopes.join(' ')),
      JSON.stringify(scopes),
      now,
      now,
    ).run();
  }

  async hasOAuthConsent(input: { operatorId: string; clientId: string; scopes: string[] }): Promise<boolean> {
    await this.ensureSchema();
    const scopes = normalizeStringList(input.scopes).sort();
    const row = await this.db.prepare(
      `SELECT id
       FROM oauth_consents
       WHERE operator_id = ? AND client_id = ? AND scopes_hash = ? AND revoked_at IS NULL
       LIMIT 1`,
    ).bind(input.operatorId, input.clientId, await hashText(scopes.join(' '))).first<Record<string, unknown>>();
    return !!row;
  }

  async issueOAuthTokenSession(input: OAuthTokenSessionInput): Promise<{ sessionId: string; accessExpiresAt: number; refreshExpiresAt: number }> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const sessionId = opaqueId('oauthsess');
    const accessExpiresAt = input.accessExpiresAt ?? now + ACCESS_TOKEN_TTL_MS;
    const refreshExpiresAt = input.refreshExpiresAt ?? now + REFRESH_TOKEN_TTL_MS;
    await this.db.prepare(
      `INSERT INTO oauth_token_sessions (
         id,
         operator_id,
         client_id,
         access_token_hash,
         refresh_token_hash,
         scopes_json,
         access_expires_at,
         refresh_expires_at,
         created_at,
         updated_at,
         revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      sessionId,
      input.operatorId,
      input.clientId,
      await hashText(input.accessToken),
      await hashText(input.refreshToken),
      JSON.stringify(normalizeStringList(input.scopes)),
      accessExpiresAt,
      refreshExpiresAt,
      now,
      now,
    ).run();
    return { sessionId, accessExpiresAt, refreshExpiresAt };
  }

  async revokeOAuthTokenSession(sessionId: string, now: number = Date.now()): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare(
      `UPDATE oauth_token_sessions
       SET revoked_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, now, sessionId).run();
  }

  async listSecuritySessions(operatorId: string, options: {
    now?: number;
    limit?: number;
  } = {}): Promise<SecuritySessionRecord[]> {
    await this.ensureSchema();
    const now = options.now ?? Date.now();
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const webRows = await this.db.prepare(
      `SELECT id, operator_id, created_at, last_seen_at, expires_at, revoked_at
       FROM web_sessions
       WHERE operator_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).bind(operatorId, limit).all<Record<string, unknown>>();
    const oauthRows = await this.db.prepare(
      `SELECT s.id, s.operator_id, s.client_id, c.client_name, s.created_at, s.updated_at, s.refresh_expires_at, s.revoked_at
       FROM oauth_token_sessions s
       LEFT JOIN oauth_clients c ON c.client_id = s.client_id
       WHERE s.operator_id = ?
       ORDER BY s.created_at DESC
       LIMIT ?`,
    ).bind(operatorId, limit).all<Record<string, unknown>>();

    return [
      ...(webRows.results ?? []).map(row => rowToSecuritySession(row, 'web', now)),
      ...(oauthRows.results ?? []).map(row => rowToSecuritySession(row, 'oauth', now)),
    ].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async revokeSecuritySession(input: {
    operatorId: string;
    sessionId: string;
    now?: number;
  }): Promise<{ revoked: boolean; kind?: 'web' | 'oauth' }> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    const webResult = await this.db.prepare(
      `UPDATE web_sessions
       SET revoked_at = ?, updated_at = ?
       WHERE id = ? AND operator_id = ? AND revoked_at IS NULL`,
    ).bind(now, now, input.sessionId, input.operatorId).run();
    if (numberValue(webResult.meta?.changes) && numberValue(webResult.meta?.changes)! > 0) {
      return { revoked: true, kind: 'web' };
    }

    const oauthResult = await this.db.prepare(
      `UPDATE oauth_token_sessions
       SET revoked_at = ?, updated_at = ?
       WHERE id = ? AND operator_id = ? AND revoked_at IS NULL`,
    ).bind(now, now, input.sessionId, input.operatorId).run();
    if (numberValue(oauthResult.meta?.changes) && numberValue(oauthResult.meta?.changes)! > 0) {
      return { revoked: true, kind: 'oauth' };
    }
    return { revoked: false };
  }

  async bootstrapDefaultTenantForOperator(input: {
    operatorId: string;
    tenantId?: string | null;
    resourceId?: string | null;
    tenantName?: string | null;
    resourceName?: string | null;
    now?: number;
  }): Promise<BootstrapTenantResult> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.ensureLegacyUserForOperatorId(input.operatorId, now);

    const existing = await this.getTenantContextForOperator(input.operatorId, { source: 'rest' });
    if (existing.tenants.length > 0) {
      const tenant = existing.tenants[0];
      const resource = existing.accounts.find(account => account.tenantId === tenant.tenantId)
        ?? secretSafeResourceFallback(tenant.tenantId);
      return { created: false, tenant, resource };
    }

    const ownedTenant = await this.findOwnedTenantForOperator(input.operatorId);
    if (ownedTenant) {
      const tenantId = stringValue(ownedTenant.tenant_id) || '';
      const resourceId = stringValue(ownedTenant.tenant_default_account_id) || input.resourceId || opaqueId('acct');
      const resourceName = input.resourceName || '默认公众号资源';
      await this.ensureBootstrapTenantArtifacts({
        operatorId: input.operatorId,
        tenantId,
        resourceId,
        resourceName,
        now,
      });
      const resource = await this.getWechatResource(tenantId, resourceId);
      return {
        created: false,
        tenant: {
          tenantId,
          slug: stringValue(ownedTenant.tenant_slug) || tenantId,
          name: stringValue(ownedTenant.tenant_name) || input.tenantName || '默认租户',
          role: 'owner',
          status: stringValue(ownedTenant.tenant_status) === 'disabled' ? 'disabled' : 'active',
        },
        resource: resource ?? secretSafeResourceFallback(tenantId),
      };
    }

    const tenantId = input.tenantId || opaqueId('ten');
    const resourceId = input.resourceId || opaqueId('acct');
    const tenantName = input.tenantName || '默认租户';
    const resourceName = input.resourceName || '默认公众号资源';
    await this.db.prepare(
      `INSERT INTO tenants (id, slug, name, status, default_account_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(tenantId, tenantId, tenantName, resourceId, now, now).run();
    await this.db.prepare(
      `INSERT INTO tenant_owners (tenant_id, operator_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tenant_id) DO NOTHING`,
    ).bind(tenantId, input.operatorId, now).run();
    await this.ensureBootstrapTenantArtifacts({
      operatorId: input.operatorId,
      tenantId,
      resourceId,
      now,
      resourceName,
    });

    return {
      created: true,
      tenant: { tenantId, slug: tenantId, name: tenantName, role: 'owner', status: 'active' },
      resource: { tenantId, accountId: resourceId, slug: resourceId, name: resourceName, status: 'unconfigured', isDefault: true },
    };
  }

  async getTenantContextForOperator(input: string | { operatorId: string; oauthClientId?: string | null; scopes?: string[] | null; requestId?: string | null }, options: {
    source: TenantRequestContext['source'];
  }): Promise<TenantRequestContext> {
    await this.ensureSchema();
    const operatorId = typeof input === 'string' ? input : input.operatorId;
    const tenantRows = await this.db.prepare(
      `SELECT t.id AS tenant_id,
              t.slug AS tenant_slug,
              t.name AS tenant_name,
              t.status AS tenant_status,
              t.default_account_id AS tenant_default_account_id,
              m.role AS role,
              m.scopes_json AS scopes_json,
              m.default_account_id AS member_default_account_id
       FROM tenant_memberships m
       INNER JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ? AND m.status = 'active' AND t.status != 'disabled'
       ORDER BY t.created_at ASC`,
    ).bind(operatorId).all<Record<string, unknown>>();

    const tenants = (tenantRows.results ?? []).map(rowToTenantSummary);
    const scopes = typeof input === 'string'
      ? ownerScopes()
      : normalizeStringList(input.scopes?.length ? input.scopes : scopesFromTenantRows(tenantRows.results ?? []));
    const accounts: AccountSummary[] = [];
    for (const tenant of tenants) {
      const accountRows = await this.db.prepare(
        `SELECT id, tenant_id, slug, name, app_id, status, is_default
         FROM wechat_accounts
         WHERE tenant_id = ? AND status != 'disabled'
         ORDER BY is_default DESC, created_at ASC`,
      ).bind(tenant.tenantId).all<Record<string, unknown>>();
      accounts.push(...(accountRows.results ?? []).map(rowToAccountSummary));
    }

    const defaultTenantId = tenants[0]?.tenantId;
    const defaultAccountId = accounts.find(account => account.tenantId === defaultTenantId && account.isDefault)?.accountId
      ?? accounts.find(account => account.tenantId === defaultTenantId)?.accountId;

    return {
      userId: operatorId,
      oauthClientId: typeof input === 'string' ? undefined : input.oauthClientId ?? undefined,
      scopes: scopes.length > 0 ? scopes : ownerScopes(),
      tenants,
      accounts,
      defaultTenantId,
      defaultAccountId,
      requestId: typeof input === 'string' ? opaqueId('req') : input.requestId || opaqueId('req'),
      source: options.source,
    };
  }

  async createWechatResource(input: CreateWechatResourceInput): Promise<WechatResourceRecord> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.assertAccountAllowance(input.tenantId);
    const resourceId = input.resourceId || opaqueId('acct');
    await this.insertWechatResource({
      tenantId: input.tenantId,
      resourceId,
      slug: input.slug || resourceId,
      name: input.name || '未配置公众号资源',
      status: 'unconfigured',
      isDefault: false,
      now,
    });
    const resource = await this.getWechatResource(input.tenantId, resourceId);
    if (!resource) {
      throw new Error('Failed to create WeChat resource.');
    }
    return resource;
  }

  async getWechatResource(tenantId: string, resourceId: string): Promise<WechatResourceRecord | null> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT id, tenant_id, slug, name, app_id, app_secret, webhook_token, encoding_aes_key, status, is_default, created_at, updated_at
       FROM wechat_accounts
       WHERE tenant_id = ? AND id = ? AND status != 'disabled'
       LIMIT 1`,
    ).bind(tenantId, resourceId).first<Record<string, unknown>>();
    return row ? rowToWechatResource(row) : null;
  }

  async listWechatResources(tenantId: string): Promise<WechatResourceRecord[]> {
    await this.ensureSchema();
    const rows = await this.db.prepare(
      `SELECT id, tenant_id, slug, name, app_id, app_secret, webhook_token, encoding_aes_key, status, is_default, created_at, updated_at
       FROM wechat_accounts
       WHERE tenant_id = ? AND status != 'disabled'
       ORDER BY is_default DESC, created_at ASC`,
    ).bind(tenantId).all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToWechatResource);
  }

  async renameWechatResource(input: { tenantId: string; resourceId: string; name: string; now?: number }): Promise<WechatResourceRecord> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET name = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ? AND status != 'disabled'`,
    ).bind(input.name, now, input.tenantId, input.resourceId).run();
    const resource = await this.getWechatResource(input.tenantId, input.resourceId);
    if (!resource) throw new Error('WeChat resource not found.');
    return resource;
  }

  async setDefaultWechatResource(input: { tenantId: string; resourceId: string; now?: number }): Promise<WechatResourceRecord> {
    await this.ensureSchema();
    const resource = await this.getWechatResource(input.tenantId, input.resourceId);
    if (!resource) throw new Error('WeChat resource not found.');
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET is_default = 0, updated_at = ?
       WHERE tenant_id = ?`,
    ).bind(now, input.tenantId).run();
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET is_default = 1, updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
    ).bind(now, input.tenantId, input.resourceId).run();
    await this.db.prepare(
      `UPDATE tenants
       SET default_account_id = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(input.resourceId, now, input.tenantId).run();
    return { ...resource, isDefault: true };
  }

  async softDeleteWechatResource(input: { tenantId: string; resourceId: string; confirmation: string; now?: number }): Promise<void> {
    await this.ensureSchema();
    if (input.confirmation !== `DELETE ${input.resourceId}`) {
      throw new Error(`Resource deletion requires confirmation marker: DELETE ${input.resourceId}`);
    }
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET app_id = NULL,
           app_secret = NULL,
           webhook_token = NULL,
           encoding_aes_key = NULL,
           status = 'disabled',
           is_default = 0,
           updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
    ).bind(now, input.tenantId, input.resourceId).run();
    await this.db.prepare(
      `DELETE FROM wechat_access_tokens
       WHERE tenant_id = ? AND account_id = ?`,
    ).bind(input.tenantId, input.resourceId).run();

    const nextDefault = (await this.listWechatResources(input.tenantId))[0];
    await this.db.prepare(
      `UPDATE tenants
       SET default_account_id = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(nextDefault?.accountId ?? null, now, input.tenantId).run();
    if (nextDefault) {
      await this.setDefaultWechatResource({ tenantId: input.tenantId, resourceId: nextDefault.accountId, now });
    }
  }

  async configureValidatedWechatCredentials(input: ConfigureWechatCredentialsInput): Promise<WechatResourceRecord> {
    await this.ensureSchema();
    const existing = await this.db.prepare(
      `SELECT id
       FROM wechat_accounts
       WHERE app_id = ? AND status != 'disabled' AND NOT (tenant_id = ? AND id = ?)
       LIMIT 1`,
    ).bind(input.config.appId, input.tenantId, input.resourceId).first<Record<string, unknown>>();
    if (existing) {
      throw new DuplicateAppIdError(input.config.appId);
    }

    const now = input.now ?? Date.now();
    await this.db.prepare(
      `UPDATE wechat_accounts
       SET app_id = ?,
           app_secret = ?,
           webhook_token = ?,
           encoding_aes_key = ?,
           status = 'active',
           updated_at = ?
       WHERE tenant_id = ? AND id = ? AND status != 'disabled'`,
    ).bind(
      input.config.appId,
      this.encryptValue(input.config.appSecret),
      this.encryptValue(input.config.token ?? null),
      this.encryptValue(input.config.encodingAESKey ?? null),
      now,
      input.tenantId,
      input.resourceId,
    ).run();

    if (input.tokenInfo) {
      await this.db.prepare(
        `INSERT INTO wechat_access_tokens (tenant_id, account_id, access_token, expires_in, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, account_id) DO UPDATE SET
           access_token = excluded.access_token,
           expires_in = excluded.expires_in,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      ).bind(
        input.tenantId,
        input.resourceId,
        this.encryptValue(input.tokenInfo.accessToken),
        input.tokenInfo.expiresIn,
        input.tokenInfo.expiresAt,
        now,
        now,
      ).run();
    }

    const resource = await this.getWechatResource(input.tenantId, input.resourceId);
    if (!resource) throw new Error('WeChat resource not found after credential configuration.');
    return resource;
  }

  async validateAndPersistWechatCredentials(input: ValidateAndPersistCredentialsInput): Promise<WechatResourceRecord> {
    await this.ensureSchema();
    const tokenInfo = await input.validate(input.config);
    return await this.configureValidatedWechatCredentials({
      ...input,
      tokenInfo: tokenInfo ?? input.tokenInfo ?? null,
    });
  }

  async getTenantEntitlement(tenantId: string): Promise<{ tenantId: string; plan: SubscriptionPlan; status: string }> {
    await this.ensureSchema();
    const row = await this.db.prepare(
      `SELECT plan, status
       FROM tenant_entitlements
       WHERE tenant_id = ?
       LIMIT 1`,
    ).bind(tenantId).first<Record<string, unknown>>();
    return {
      tenantId,
      plan: normalizeSubscriptionPlan(row?.plan),
      status: stringValue(row?.status) || 'active',
    };
  }

  async upsertTenantEntitlement(input: { tenantId: string; plan: SubscriptionPlan; status?: string; now?: number }): Promise<void> {
    await this.ensureSchema();
    const now = input.now ?? Date.now();
    await this.db.prepare(
      `INSERT INTO tenant_entitlements (tenant_id, plan, status, limits_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         plan = excluded.plan,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).bind(input.tenantId, input.plan, input.status ?? 'active', now, now).run();
  }

  async getAccountAllowance(tenantId: string): Promise<{ tenantId: string; plan: SubscriptionPlan; limit: number; used: number; remaining: number }> {
    await this.ensureSchema();
    const entitlement = await this.getTenantEntitlement(tenantId);
    const used = await this.countConfigurableResources(tenantId);
    const limit = ACCOUNT_ALLOWANCES[entitlement.plan];
    return {
      tenantId,
      plan: entitlement.plan,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  }

  async recordMonitoringEvent(input: {
    eventType: string;
    tenantId?: string | null;
    accountId?: string | null;
    severity?: string | null;
    metadata?: Record<string, unknown> | null;
    eventId?: string | null;
    now?: number;
  }): Promise<void> {
    await this.ensureSchema();
    await this.db.prepare(
      `INSERT INTO monitoring_events (id, event_type, tenant_id, account_id, severity, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.eventId || opaqueId('mon'),
      input.eventType,
      input.tenantId ?? null,
      input.accountId ?? null,
      input.severity ?? 'info',
      JSON.stringify(redactRecord(input.metadata ?? {})),
      input.now ?? Date.now(),
    ).run();
  }

  async requestOperatorDeletion(input: { operatorId: string; supportNote?: string | null; requestId?: string | null; now?: number }): Promise<string> {
    await this.ensureSchema();
    const id = input.requestId || opaqueId('del');
    await this.db.prepare(
      `INSERT INTO operator_deletion_requests (id, operator_id, status, requested_at, completed_at, support_note)
       VALUES (?, ?, 'requested', ?, NULL, ?)`,
    ).bind(id, input.operatorId, input.now ?? Date.now(), input.supportNote ?? null).run();
    return id;
  }

  private async consumeEmailCode(codeId: string, now: number): Promise<void> {
    await this.db.prepare(
      `UPDATE operator_email_codes
       SET consumed_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, now, codeId).run();
  }

  private async assertAccountAllowance(tenantId: string): Promise<void> {
    const allowance = await this.getAccountAllowance(tenantId);
    if (allowance.used >= allowance.limit) {
      throw new AccountAllowanceError({
        code: 'account_allowance_exceeded',
        tenantId,
        plan: allowance.plan,
        limit: allowance.limit,
        used: allowance.used,
        remaining: 0,
        upgrade: {
          webUrl: `https://woa.ziikoo.app/billing?tenantId=${encodeURIComponent(tenantId)}`,
          cliCommand: 'woa billing checkout --plan plus',
          guidance: '当前订阅计划的公众号资源数量已达上限，请在 Web 或 CLI 升级后再创建。',
        },
      });
    }
  }

  private async countConfigurableResources(tenantId: string): Promise<number> {
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS count
       FROM wechat_accounts
       WHERE tenant_id = ? AND status != 'disabled'`,
    ).bind(tenantId).first<Record<string, unknown>>();
    return numberValue(row?.count) ?? 0;
  }

  private async findOperatorById(operatorId: string): Promise<OperatorRecord | null> {
    const row = await this.db.prepare(
      `SELECT id, verified_email, display_name, status, created_at, updated_at
       FROM operators
       WHERE id = ? AND status != 'disabled'
       LIMIT 1`,
    ).bind(operatorId).first<Record<string, unknown>>();
    return row ? rowToOperator(row) : null;
  }

  /**
   * 兼容 0002 多租户表仍以 users(id) 作为 tenant_memberships.user_id 外键的历史模型。
   * Operator 是新的登录主实体；在迁移窗口内为每个 Operator 补一条同 ID legacy user，
   * 避免 GitHub/email 首登 bootstrap 默认租户时触发 D1 外键失败。
   */
  private async ensureLegacyUserForOperator(operator: OperatorRecord, now: number = Date.now()): Promise<void> {
    if (!operator.operatorId) return;
    const email = operator.verifiedEmail ? normalizeEmail(operator.verifiedEmail) : '';
    const duplicateEmailUser = email
      ? await this.db.prepare(
        `SELECT id
         FROM users
         WHERE email = ? AND id != ?
         LIMIT 1`,
      ).bind(email, operator.operatorId).first<Record<string, unknown>>()
      : null;
    const legacyEmail = duplicateEmailUser ? null : email || null;
    await this.db.prepare(
      `INSERT INTO users (id, email, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = CASE
           WHEN users.email IS NULL AND excluded.email IS NOT NULL THEN excluded.email
           ELSE users.email
         END,
         display_name = CASE
           WHEN users.display_name IS NULL OR users.display_name = '' THEN excluded.display_name
           ELSE users.display_name
         END,
         status = CASE
           WHEN users.status = 'disabled' THEN users.status
           ELSE 'active'
         END,
         updated_at = excluded.updated_at`,
    ).bind(
      operator.operatorId,
      legacyEmail,
      operator.displayName || legacyEmail || operator.operatorId,
      now,
      now,
    ).run();
  }

  private async ensureLegacyUserForOperatorId(operatorId: string, now: number): Promise<void> {
    const operator = await this.findOperatorById(operatorId);
    if (operator) {
      await this.ensureLegacyUserForOperator(operator, now);
    }
  }

  private async findOwnedTenantForOperator(operatorId: string): Promise<Record<string, unknown> | null> {
    return await this.db.prepare(
      `SELECT t.id AS tenant_id,
              t.slug AS tenant_slug,
              t.name AS tenant_name,
              t.status AS tenant_status,
              t.default_account_id AS tenant_default_account_id
       FROM tenant_owners o
       INNER JOIN tenants t ON t.id = o.tenant_id
       WHERE o.operator_id = ? AND t.status != 'disabled'
       ORDER BY t.created_at ASC
       LIMIT 1`,
    ).bind(operatorId).first<Record<string, unknown>>();
  }

  private async ensureBootstrapTenantArtifacts(input: {
    operatorId: string;
    tenantId: string;
    resourceId: string;
    resourceName: string;
    now: number;
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE tenants
       SET default_account_id = COALESCE(default_account_id, ?), updated_at = ?
       WHERE id = ?`,
    ).bind(input.resourceId, input.now, input.tenantId).run();
    await this.db.prepare(
      `INSERT INTO tenant_memberships (tenant_id, user_id, role, scopes_json, default_account_id, status, created_at, updated_at)
       VALUES (?, ?, 'owner', ?, ?, 'active', ?, ?)
       ON CONFLICT(tenant_id, user_id) DO UPDATE SET
         role = 'owner',
         scopes_json = excluded.scopes_json,
         default_account_id = excluded.default_account_id,
         status = 'active',
         updated_at = excluded.updated_at`,
    ).bind(input.tenantId, input.operatorId, JSON.stringify(ownerScopes()), input.resourceId, input.now, input.now).run();

    const existingResource = await this.getWechatResource(input.tenantId, input.resourceId);
    if (!existingResource) {
      await this.insertWechatResource({
        tenantId: input.tenantId,
        resourceId: input.resourceId,
        slug: input.resourceId,
        name: input.resourceName,
        status: 'unconfigured',
        isDefault: true,
        now: input.now,
      });
    }
    await this.upsertTenantEntitlement({ tenantId: input.tenantId, plan: 'free', now: input.now });
  }

  private async insertWechatResource(input: {
    tenantId: string;
    resourceId: string;
    slug: string;
    name: string;
    status: WechatResourceStatus;
    isDefault: boolean;
    now: number;
  }): Promise<void> {
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
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
      input.resourceId,
      input.tenantId,
      input.slug,
      input.name,
      input.status,
      input.isDefault ? 1 : 0,
      input.now,
      input.now,
    ).run();
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
    if (value.startsWith('enc:')) return value;
    return `enc:${CryptoJS.AES.encrypt(value, this.secretKey).toString()}`;
  }
}

function rowToOperator(row: Record<string, unknown>): OperatorRecord {
  return {
    operatorId: stringValue(row.id) || '',
    verifiedEmail: stringValue(row.verified_email) || '',
    displayName: stringValue(row.display_name) || undefined,
    status: stringValue(row.status) || 'active',
    createdAt: numberValue(row.created_at) ?? 0,
    updatedAt: numberValue(row.updated_at) ?? 0,
  };
}

function rowToWebSession(row: Record<string, unknown>): WebSessionRecord {
  return {
    sessionId: stringValue(row.id) || '',
    operatorId: stringValue(row.operator_id) || '',
    expiresAt: numberValue(row.expires_at) ?? 0,
    revokedAt: numberValue(row.revoked_at),
  };
}

function rowToSecuritySession(row: Record<string, unknown>, kind: SecuritySessionRecord['kind'], now: number): SecuritySessionRecord {
  const revokedAt = numberValue(row.revoked_at);
  const expiresAt = kind === 'oauth'
    ? numberValue(row.refresh_expires_at) ?? 0
    : numberValue(row.expires_at) ?? 0;
  const clientId = stringValue(row.client_id) || undefined;
  return {
    id: stringValue(row.id) || '',
    kind,
    clientId,
    clientName: kind === 'web'
      ? 'Web session'
      : stringValue(row.client_name) || clientId || 'OAuth client',
    createdAt: numberValue(row.created_at) ?? 0,
    lastSeenAt: (kind === 'web'
      ? numberValue(row.last_seen_at)
      : numberValue(row.updated_at)) ?? undefined,
    expiresAt,
    revokedAt,
    canRevoke: !revokedAt && expiresAt > now,
  };
}

function rowToTenantSummary(row: Record<string, unknown>): TenantSummary {
  return {
    tenantId: stringValue(row.tenant_id) || '',
    slug: stringValue(row.tenant_slug) || stringValue(row.tenant_id) || '',
    name: stringValue(row.tenant_name) || stringValue(row.tenant_id) || '',
    role: (stringValue(row.role) || 'owner') as TenantRole,
    status: stringValue(row.tenant_status) === 'disabled' ? 'disabled' : 'active',
  };
}

function rowToAccountSummary(row: Record<string, unknown>): AccountSummary {
  const status = stringValue(row.status) || 'unconfigured';
  return {
    tenantId: stringValue(row.tenant_id) || '',
    accountId: stringValue(row.id) || '',
    slug: stringValue(row.slug) || stringValue(row.id) || '',
    name: stringValue(row.name) || stringValue(row.id) || '',
    appId: stringValue(row.app_id) || undefined,
    status: status === 'active' ? 'active' : status === 'disabled' ? 'disabled' : 'unconfigured',
    isDefault: Boolean(numberValue(row.is_default)),
  };
}

function rowToWechatResource(row: Record<string, unknown>): WechatResourceRecord {
  const account = rowToAccountSummary(row);
  return {
    ...account,
    hasAppSecret: !!stringValue(row.app_secret),
    hasWebhookToken: !!stringValue(row.webhook_token),
    hasEncodingAESKey: !!stringValue(row.encoding_aes_key),
    createdAt: numberValue(row.created_at) ?? 0,
    updatedAt: numberValue(row.updated_at) ?? 0,
  };
}

function secretSafeResourceFallback(tenantId: string): AccountSummary {
  return {
    tenantId,
    accountId: '',
    slug: '',
    name: '',
    status: 'unconfigured',
    isDefault: false,
  };
}

function ownerScopes(): string[] {
  return [
    'wechat.mcp',
    'woa:context:read',
    'woa:tenant:read',
    'woa:tenant:write',
    'woa:account:read',
    'woa:account:write',
    'woa:content:read',
    'woa:content:write',
    'woa:content:publish',
    'woa:inbox:read',
    'woa:usage:read',
    'woa:billing:write',
    'woa:audit:read',
  ];
}

function scopesFromTenantRows(rows: Record<string, unknown>[]): string[] {
  const scopes = new Set<string>();
  for (const row of rows) {
    for (const scope of parseJsonStringArray(stringValue(row.scopes_json))) {
      scopes.add(scope);
    }
  }
  return [...scopes];
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeStringList(parsed) : [];
  } catch {
    return [];
  }
}

function normalizeStringList(values: unknown[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function opaqueId(prefix: string): string {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike?.randomUUID) {
    return `${prefix}_${cryptoLike.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function hashText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = /secret|token|key|authorization/i.test(key) ? '***' : value;
  }
  return output;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function accountAllowanceForPlan(plan: SubscriptionPlan): number {
  return ACCOUNT_ALLOWANCES[plan];
}

export function planUpgradeTarget(plan: SubscriptionPlan): SubscriptionPlan | null {
  if (plan === 'free') return 'plus';
  if (plan === 'plus') return 'pro';
  return null;
}

export function publicPlanLimits(plan: SubscriptionPlan): Record<string, number> {
  return {
    account_allowance: ACCOUNT_ALLOWANCES[plan],
    ...PLAN_QUOTA_POLICIES[plan].limits,
  };
}

export function defaultSubscriptionPlan(): SubscriptionPlan {
  return DEFAULT_SUBSCRIPTION_PLAN;
}

export function toD1Value(value: unknown): D1Value {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value as D1Value;
  }
  return JSON.stringify(value);
}

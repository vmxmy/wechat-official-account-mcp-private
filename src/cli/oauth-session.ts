export interface OAuthSession {
  server?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
}

export interface EnsureFreshOAuthSessionOptions {
  fetch?: typeof fetch;
  now?: number;
  minValidityMs?: number;
  forceRefresh?: boolean;
}

export interface FreshOAuthSessionResult {
  session: OAuthSession;
  refreshed: boolean;
}

interface OAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const DEFAULT_MIN_VALIDITY_MS = 5 * 60 * 1000;

/**
 * 返回可直接使用的 OAuth 会话；刷新、轮换与有效期判断全部封装在此模块内。
 */
export async function ensureFreshOAuthSession(
  session: OAuthSession,
  options: EnsureFreshOAuthSessionOptions = {},
): Promise<FreshOAuthSessionResult> {
  const now = options.now ?? Date.now();
  const minValidityMs = options.minValidityMs ?? DEFAULT_MIN_VALIDITY_MS;
  const needsRefresh = options.forceRefresh === true
    || !session.accessToken
    || (typeof session.expiresAt === 'number' && session.expiresAt <= now + minValidityMs);

  if (!needsRefresh) {
    return { session, refreshed: false };
  }
  if (!session.refreshToken) {
    if (session.accessToken && options.forceRefresh !== true) {
      return { session, refreshed: false };
    }
    throw new Error('OAuth session cannot be refreshed. Run `woa login` again.');
  }
  if (!session.server || !session.clientId) {
    throw new Error('OAuth session is missing server or client ID. Run `woa login` again.');
  }

  const endpoint = session.tokenEndpoint || new URL('/oauth/token', session.server).toString();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });
  if (session.clientSecret) body.set('client_secret', session.clientSecret);

  const response = await (options.fetch ?? fetch)(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await readTokenResponse(response);
  if (!response.ok || typeof data.access_token !== 'string' || !data.access_token) {
    const reason = typeof data.error_description === 'string'
      ? data.error_description
      : typeof data.error === 'string'
        ? data.error
        : 'token endpoint rejected the refresh request';
    throw new Error(`OAuth refresh failed with ${response.status}: ${reason}. Run \`woa login\` again if the refresh token was revoked or expired.`);
  }

  const expiresIn = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)
    ? Math.max(0, data.expires_in)
    : undefined;
  return {
    refreshed: true,
    session: {
      ...session,
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : session.refreshToken,
      tokenType: typeof data.token_type === 'string' ? data.token_type : session.tokenType,
      scope: typeof data.scope === 'string' ? data.scope : session.scope,
      expiresAt: expiresIn === undefined ? undefined : now + expiresIn * 1000,
      tokenEndpoint: endpoint,
    },
  };
}

async function readTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as OAuthTokenResponse;
  } catch {
    return {};
  }
}

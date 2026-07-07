export interface GitHubOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GitHubUserResponse {
  id?: number | string;
  login?: string;
  name?: string | null;
  email?: string | null;
}

export interface GitHubEmailResponse {
  email?: string;
  primary?: boolean;
  verified?: boolean;
  visibility?: string | null;
}

export interface GitHubOAuthProfile {
  providerSubject: string;
  login: string;
  displayName: string;
  verifiedEmail: string | null;
  fallbackEmail: string | null;
}

type FetchLike = typeof fetch;

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER_URL = 'https://api.github.com/user';
const GITHUB_API_EMAILS_URL = 'https://api.github.com/user/emails';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_USER_AGENT = 'ziikoo-woa/2.2.0';

export function createGitHubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', input.scope ?? 'read:user user:email');
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

export async function exchangeGitHubOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: FetchLike;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await (input.fetch ?? fetch)(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': GITHUB_USER_AGENT,
    },
    body,
  });
  const data = await response.json().catch(() => ({})) as GitHubOAuthTokenResponse;
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`GitHub OAuth token exchange failed: ${detail}`);
  }
  return data.access_token;
}

export async function fetchGitHubOAuthProfile(input: {
  accessToken: string;
  fetch?: FetchLike;
}): Promise<GitHubOAuthProfile> {
  const fetchImpl = input.fetch ?? fetch;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${input.accessToken}`,
    'user-agent': GITHUB_USER_AGENT,
    'x-github-api-version': GITHUB_API_VERSION,
  };

  const userResponse = await fetchImpl(GITHUB_API_USER_URL, { headers });
  const user = await userResponse.json().catch(() => ({})) as GitHubUserResponse;
  if (!userResponse.ok || user.id === undefined || user.id === null) {
    throw new Error(`GitHub user lookup failed: HTTP ${userResponse.status}`);
  }

  const emailsResponse = await fetchImpl(GITHUB_API_EMAILS_URL, { headers });
  const emails = await emailsResponse.json().catch(() => []) as GitHubEmailResponse[];
  if (!emailsResponse.ok || !Array.isArray(emails)) {
    throw new Error(`GitHub email lookup failed: HTTP ${emailsResponse.status}`);
  }

  const verifiedEmail = selectVerifiedGitHubEmail(emails);
  const fallbackEmail = normalizeEmail(user.email);
  const login = normalizeText(user.login) || `github-${String(user.id)}`;

  return {
    providerSubject: String(user.id),
    login,
    displayName: normalizeText(user.name) || login || verifiedEmail || fallbackEmail || `GitHub ${String(user.id)}`,
    verifiedEmail,
    fallbackEmail,
  };
}

export function selectVerifiedGitHubEmail(emails: GitHubEmailResponse[]): string | null {
  const verified = emails
    .map(email => ({
      email: normalizeEmail(email.email),
      primary: email.primary === true,
      verified: email.verified === true,
    }))
    .filter(email => email.email && email.verified);
  return verified.find(email => email.primary)?.email ?? verified[0]?.email ?? null;
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

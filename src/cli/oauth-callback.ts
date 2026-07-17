export interface PendingOAuthCallback {
  redirectUri: string;
  state: string;
}

/** Validate the browser return value without persisting or logging the authorization code. */
export function authorizationCodeFromCallback(
  callbackUrlText: string,
  pending: PendingOAuthCallback,
): string {
  let callbackUrl: URL;
  let expectedRedirect: URL;
  try {
    callbackUrl = new URL(callbackUrlText);
    expectedRedirect = new URL(pending.redirectUri);
  } catch {
    throw new Error('login complete received an invalid callback URL.');
  }
  if (callbackUrl.origin !== expectedRedirect.origin || callbackUrl.pathname !== expectedRedirect.pathname) {
    throw new Error('OAuth callback URL does not match the pending loopback redirect URI.');
  }
  const oauthError = callbackUrl.searchParams.get('error');
  if (oauthError) throw new Error(`OAuth authorization failed: ${oauthError}`);
  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');
  if (!code || state !== pending.state) {
    throw new Error('OAuth callback state mismatch or missing code.');
  }
  return code;
}

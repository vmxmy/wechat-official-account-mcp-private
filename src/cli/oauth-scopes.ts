export const DEFAULT_CLI_SCOPES = [
  'woa:context:read',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
].join(' ');

export const WECHAT_FULL_CLI_SCOPES = [
  'woa:context:read',
  'woa:account:read',
  'woa:account:write',
  'woa:content:read',
  'woa:content:write',
  'woa:content:publish',
  'woa:inbox:read',
].join(' ');

export function cliScopesForProfile(profile?: string): string {
  if (!profile) return DEFAULT_CLI_SCOPES;
  if (profile === 'wechat-full') return WECHAT_FULL_CLI_SCOPES;
  throw new Error('login --scope-profile currently supports only wechat-full.');
}

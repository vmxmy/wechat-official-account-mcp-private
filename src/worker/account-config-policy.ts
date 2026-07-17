import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_TENANT_ID,
  type AccountContext,
} from '../storage/types.js';

/** Global Worker secrets are a rollback bridge for the one historical default account only. */
export function canUseLegacyGlobalWechatSecrets(accountContext: AccountContext): boolean {
  return accountContext.tenantId === DEFAULT_TENANT_ID && accountContext.accountId === DEFAULT_ACCOUNT_ID;
}

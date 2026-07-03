import type { InboxStore } from '../mcp-tool/inbox-store.js';
import type { AccountContext } from '../storage/types.js';
import { WechatApiClient, type WechatAuthManagerLike } from './api-client.js';
import type { HttpExecutor } from './http-executor.js';

export interface WechatApiClientFactoryOptions {
  createAuthManager(accountContext: AccountContext): Promise<WechatAuthManagerLike> | WechatAuthManagerLike;
  createHttpExecutor(accountContext: AccountContext): Promise<HttpExecutor> | HttpExecutor;
  createInboxStore?(accountContext: AccountContext): Promise<InboxStore | undefined> | InboxStore | undefined;
}

/**
 * Account-scoped WeChat API client factory.
 *
 * All Workers runtime callers should resolve an authorized AccountContext before using this factory.
 * The factory keeps WechatApiClient HTTP-only by requiring an explicit executor per account.
 */
export class WechatApiClientFactory {
  constructor(private readonly options: WechatApiClientFactoryOptions) {}

  async create(accountContext: AccountContext): Promise<WechatApiClient> {
    const authManager = await this.options.createAuthManager(accountContext);
    const httpExecutor = await this.options.createHttpExecutor(accountContext);
    const inboxStore = this.options.createInboxStore
      ? await this.options.createInboxStore(accountContext)
      : undefined;

    return new WechatApiClient(authManager, {
      httpExecutor,
      inboxStore,
    });
  }
}

import type { InitConsoleSnapshot } from './init-command.js';
import type { CliMcpCallResult, CliMcpTool } from './mcp-api-client.js';

/**
 * Data presented by the human-operated Ink console.  These are deliberately
 * public, redacted projections: credentials and OAuth material never cross
 * this boundary.
 */
export interface UiTenant {
  tenantId: string;
  name?: string;
  slug?: string;
  role?: string;
  status?: string;
}

export interface UiAccount {
  tenantId: string;
  accountId: string;
  name?: string;
  slug?: string;
  appId?: string;
  status?: string;
  isDefault?: boolean;
  configured?: boolean;
  hasAppSecret?: boolean;
  updatedAt?: number;
}

export interface UiContentItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  updatedAt?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface UiUsageMetric {
  name: string;
  used?: number;
  limit?: number;
  unit?: string;
}

export interface UiUsageSummary {
  plan?: string;
  resetAt?: string;
  metrics: UiUsageMetric[];
  upgradePrompt?: string;
}

export interface UiSession {
  id: string;
  label: string;
  createdAt?: string;
  lastSeenAt?: string;
  current?: boolean;
  kind?: string;
}

export interface UiConsoleDataError {
  area: string;
  message: string;
}

export interface UiConsoleSnapshot {
  init: InitConsoleSnapshot;
  server?: string;
  authenticated: boolean;
  operator?: {
    displayName?: string;
    email?: string;
    scopes?: string[];
  };
  tenants: UiTenant[];
  accounts: UiAccount[];
  activeTenantId?: string;
  activeAccountId?: string;
  usage?: UiUsageSummary;
  drafts: UiContentItem[];
  publishes: UiContentItem[];
  inbox: UiContentItem[];
  tools: CliMcpTool[];
  sessions: UiSession[];
  mcpDescriptor?: string;
  mcpConfig?: string;
  errors: UiConsoleDataError[];
  refreshedAt: number;
}

export interface UiMutationResult {
  message: string;
}

export interface UiToolCallInput {
  tool: CliMcpTool;
  arguments: Record<string, unknown>;
  confirmation?: string;
}

/**
 * All request methods are injected by the CLI entry point.  Ink remains a
 * presentation layer and never owns OAuth credentials or REST URL assembly.
 */
export interface UiConsoleServices {
  refresh: () => Promise<UiConsoleSnapshot>;
  switchScope: (scope: { tenantId: string; accountId?: string }) => Promise<UiMutationResult>;
  createAccount: (input: { tenantId: string; name: string }) => Promise<UiMutationResult>;
  renameAccount: (input: { tenantId: string; accountId: string; name: string }) => Promise<UiMutationResult>;
  setDefaultAccount: (input: { tenantId: string; accountId: string }) => Promise<UiMutationResult>;
  disableAccount: (input: { tenantId: string; accountId: string; confirmation: string }) => Promise<UiMutationResult>;
  refreshAccountToken: (input: { tenantId: string; accountId: string }) => Promise<UiMutationResult>;
  deleteDraft: (input: { tenantId: string; accountId: string; mediaId: string; confirmation: string }) => Promise<UiMutationResult>;
  deletePublish: (input: { tenantId: string; accountId: string; articleId: string; confirmation: string }) => Promise<UiMutationResult>;
  uploadMedia: (input: { tenantId: string; accountId: string; filePath: string }) => Promise<UiMutationResult>;
  callTool: (input: UiToolCallInput) => Promise<CliMcpCallResult>;
  checkout: (input: { tenantId: string; plan: 'plus' | 'pro' }) => Promise<UiMutationResult>;
  revokeSession: (input: { sessionId: string; confirmation: string }) => Promise<UiMutationResult>;
}

/** Operations that deliberately leave Ink before using trusted terminal input or OAuth browser flows. */
export type UiConsoleExitAction =
  | 'start'
  | 'resume'
  | 'exit'
  | { kind: 'login' }
  | { kind: 'configure_account'; tenantId: string; accountId: string; appId: string };

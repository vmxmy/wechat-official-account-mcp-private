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
  /** Immutable source scope used for destructive content actions. */
  tenantId: string;
  accountId: string;
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

/**
 * Minimal onboarding status projection. Do not add raw init events here: they
 * can include OAuth URLs, idempotency keys, remote target IDs, and tool args.
 */
export interface UiInitSnapshot {
  canResume: boolean;
  event?: {
    status: string;
    phase: string;
  };
}

/**
 * A deliberately small MCP catalogue projection. The complete remote schema
 * and annotations never enter the renderer.
 */
export interface UiMcpTool {
  name: string;
  description?: string;
  requiredFields: string[];
  scopeBound: boolean;
  readOnly: boolean;
  destructive: boolean;
}

/** Safe, display-only projection of an MCP tool response. */
export interface UiToolCallResult {
  isError: boolean;
  displayText: string;
}

export interface UiConsoleSnapshot {
  init: UiInitSnapshot;
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
  tools: UiMcpTool[];
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
  tool: UiMcpTool;
  tenantId: string;
  accountId: string;
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
  callTool: (input: UiToolCallInput) => Promise<UiToolCallResult>;
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

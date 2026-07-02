export interface RelayProxyConfig {
  mode: 'relay';
  url: string;
  token?: string | null;
  targetParam?: string;
  targetHeader?: string;
  tokenHeader?: string;
}

export type OutboundProxyConfig = RelayProxyConfig;

export function loadProxyConfigFromEnv(env: Record<string, string | undefined> = getProcessEnv()): OutboundProxyConfig | undefined {
  const relayUrl = firstNonEmpty(env.WECHAT_PROXY_URL, env.WECHAT_RELAY_PROXY_URL);
  if (!relayUrl) {
    return undefined;
  }

  return {
    mode: 'relay',
    url: relayUrl,
    token: firstNonEmpty(env.WECHAT_PROXY_TOKEN, env.WECHAT_RELAY_PROXY_TOKEN),
  };
}

export function assertRelayProxy(proxy: OutboundProxyConfig | undefined): RelayProxyConfig | undefined {
  return proxy;
}

export function buildRelayProxyUrl(proxy: RelayProxyConfig, targetUrl: string): string {
  const proxyUrl = new URL(proxy.url);
  if (proxy.targetParam) {
    proxyUrl.searchParams.set(proxy.targetParam, targetUrl);
  }
  return proxyUrl.toString();
}

export function applyRelayProxyHeaders<T extends Headers | Record<string, unknown>>(
  headers: T,
  proxy: RelayProxyConfig,
  targetUrl: string,
): T {
  const targetHeader = proxy.targetHeader ?? 'x-wechat-proxy-target-url';
  const tokenHeader = proxy.tokenHeader ?? 'x-wechat-proxy-token';

  if (headers instanceof Headers) {
    headers.set(targetHeader, targetUrl);
    if (proxy.token) {
      headers.set(tokenHeader, proxy.token);
    }
    return headers;
  }

  return {
    ...headers,
    [targetHeader]: targetUrl,
    ...(proxy.token ? { [tokenHeader]: proxy.token } : {}),
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function getProcessEnv(): Record<string, string | undefined> {
  if (typeof process === 'undefined' || !process.env) {
    return {};
  }
  return process.env;
}

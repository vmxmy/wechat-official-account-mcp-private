import type { HttpExecutor, HttpRequestConfig, HttpResponse } from './http-executor.js';
import {
  applyRelayProxyHeaders,
  assertRelayProxy,
  buildRelayProxyUrl,
  type OutboundProxyConfig,
  type RelayProxyConfig,
} from './proxy.js';

export interface WorkersHttpExecutorOptions {
  baseURL?: string;
  timeout?: number;
  fetch?: typeof fetch;
  proxy?: OutboundProxyConfig | null;
}

/**
 * Cloudflare Workers HTTP 执行器。
 *
 * 使用标准 fetch / Web FormData / Uint8Array，不依赖 axios、Node FormData、Buffer 或 fs。
 */
export class WorkersHttpExecutor implements HttpExecutor {
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly proxy?: RelayProxyConfig;

  constructor(options: WorkersHttpExecutorOptions = {}) {
    this.baseURL = options.baseURL ?? 'https://api.weixin.qq.com';
    this.timeout = options.timeout ?? 30000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.proxy = assertRelayProxy(options.proxy ?? undefined);
  }

  async get<T = any>(path: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>('GET', path, undefined, config);
  }

  async post<T = any>(path: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    const { body, config: requestConfig } = this.toPostRequest(data, config);
    return this.request<T>('POST', path, body, requestConfig);
  }

  async postForm<T = any>(path: string, formData: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>('POST', path, formData as BodyInit, config);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: BodyInit,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeout = config?.timeout ?? this.timeout;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const targetUrl = this.buildURL(path, config?.params);
      const requestUrl = this.proxy ? buildRelayProxyUrl(this.proxy, targetUrl) : targetUrl;
      const headers = this.toHeaders(config?.headers);
      if (this.proxy) {
        applyRelayProxyHeaders(headers, this.proxy, targetUrl);
      }

      const response = await this.fetchImpl(requestUrl, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const data = await this.parseResponse<T>(response, config?.responseType);

      if (!response.ok) {
        const error = new Error(`Wechat API HTTP ${response.status}`) as Error & {
          response?: { status: number; data: T };
        };
        error.response = { status: response.status, data };
        throw error;
      }

      return {
        data,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildURL(path: string, params?: Record<string, unknown>): string {
    const url = new URL(path, this.baseURL);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) {
          continue;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private toPostRequest(data: unknown, config?: HttpRequestConfig): {
    body?: BodyInit;
    config?: HttpRequestConfig;
  } {
    if (data === undefined || data === null) {
      return { body: undefined, config };
    }

    if (this.isBodyInit(data)) {
      return { body: data, config };
    }

    const headers = this.toHeaders(config?.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }

    return {
      body: JSON.stringify(data),
      config: {
        ...config,
        headers: Object.fromEntries(headers.entries()),
      },
    };
  }

  private toHeaders(headers?: Record<string, unknown>): Headers {
    const result = new Headers();
    if (!headers) {
      return result;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) {
        continue;
      }
      result.set(key, String(value));
    }

    return result;
  }

  private async parseResponse<T>(response: Response, responseType?: HttpRequestConfig['responseType']): Promise<T> {
    if (responseType === 'arraybuffer') {
      return await response.arrayBuffer() as T;
    }

    if (responseType === 'text') {
      return await response.text() as T;
    }

    const text = await response.text();
    if (!text) {
      return null as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      return JSON.parse(text) as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private isBodyInit(data: unknown): data is BodyInit {
    return (
      typeof data === 'string' ||
      data instanceof FormData ||
      data instanceof Blob ||
      data instanceof ArrayBuffer ||
      data instanceof URLSearchParams ||
      data instanceof Uint8Array
    );
  }
}

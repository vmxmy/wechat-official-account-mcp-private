import { logger } from '../utils/logger.js';

export type HttpResponseType = 'arraybuffer' | 'json' | 'text' | 'blob' | 'stream' | 'document';

export interface HttpRequestConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  responseType?: HttpResponseType;
  timeout?: number;
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  headers: unknown;
}

/**
 * 运行时无关 HTTP 执行器。
 * HTTP-only runtime uses WorkersHttpExecutor (fetch/Web FormData).
 */
export interface HttpExecutor {
  get<T = any>(path: string, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  post<T = any>(path: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  postForm<T = any>(path: string, formData: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
}

export type AccessTokenProvider = () => Promise<string>;

/**
 * 共享 token 注入与安全错误日志包装。
 * 保持 API 方法不感知运行时，也避免在日志中输出完整响应体。
 */
export class AccessTokenHttpExecutor implements HttpExecutor {
  constructor(
    private readonly inner: HttpExecutor,
    private readonly getAccessToken: AccessTokenProvider
  ) {}

  async get<T = any>(path: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.withSafeErrorLogging(async () => this.inner.get<T>(await this.withAccessToken(path), config));
  }

  async post<T = any>(path: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.withSafeErrorLogging(async () => this.inner.post<T>(await this.withAccessToken(path), data, config));
  }

  async postForm<T = any>(path: string, formData: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.withSafeErrorLogging(async () => this.inner.postForm<T>(await this.withAccessToken(path), formData, config));
  }

  private async withAccessToken(path: string): Promise<string> {
    if (path.includes('access_token=')) {
      return path;
    }

    const accessToken = await this.getAccessToken();
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}access_token=${accessToken}`;
  }

  private async withSafeErrorLogging<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const status = (error as any)?.response?.status;
      logger.error('Wechat API request failed:', status ? String(status) : (error as any)?.message ?? String(error));
      throw error;
    }
  }
}

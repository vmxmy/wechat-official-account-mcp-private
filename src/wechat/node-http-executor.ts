import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpExecutor, HttpRequestConfig, HttpResponse } from './http-executor.js';

/**
 * Node.js HTTP 执行器，封装现有 axios 行为。
 */
export class NodeHttpExecutor implements HttpExecutor {
  private readonly client: AxiosInstance;

  constructor(baseURL = 'https://api.weixin.qq.com', timeout = 30000) {
    this.client = axios.create({
      baseURL,
      timeout,
    });
  }

  async get<T = any>(path: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.client.get<T>(path, this.toAxiosConfig(config));
  }

  async post<T = any>(path: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.client.post<T>(path, data, this.toAxiosConfig(config));
  }

  async postForm<T = any>(path: string, formData: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.post<T>(path, formData, config);
  }

  private toAxiosConfig(config?: HttpRequestConfig): AxiosRequestConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      params: config.params,
      headers: config.headers as AxiosRequestConfig['headers'],
      responseType: config.responseType as AxiosRequestConfig['responseType'],
      timeout: config.timeout,
    };
  }
}

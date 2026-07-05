import { logger } from '../utils/logger.js';
import type { HttpExecutor } from './http-executor.js';
import type { AccessTokenInfo, WechatConfig } from '../mcp-tool/types.js';
import type { InboxStore } from '../mcp-tool/inbox-store.js';

export interface WechatAuthManagerLike {
  setConfig(config: WechatConfig): Promise<void>;
  getConfig(): Promise<WechatConfig | null>;
  getAccessToken(): Promise<AccessTokenInfo>;
  refreshAccessToken(): Promise<AccessTokenInfo>;
  isConfigured(): boolean;
  clearAuth(): Promise<void>;
}

export interface WechatApiClientOptions {
  httpExecutor?: HttpExecutor;
  inboxStore?: InboxStore;
}

function normalizeClientOptions(optionsOrExecutor?: HttpExecutor | WechatApiClientOptions): WechatApiClientOptions {
  if (!optionsOrExecutor) {
    return {};
  }

  if (
    typeof (optionsOrExecutor as HttpExecutor).get === 'function' &&
    typeof (optionsOrExecutor as HttpExecutor).post === 'function' &&
    typeof (optionsOrExecutor as HttpExecutor).postForm === 'function'
  ) {
    return { httpExecutor: optionsOrExecutor as HttpExecutor };
  }

  return optionsOrExecutor as WechatApiClientOptions;
}

function formHeadersConfig(formData: unknown): { headers?: Record<string, unknown> } | undefined {
  const getHeaders = (formData as { getHeaders?: () => Record<string, unknown> })?.getHeaders;
  if (typeof getHeaders !== 'function') {
    return undefined;
  }

  return {
    headers: {
      ...getHeaders.call(formData),
    },
  };
}

function toBlobPart(media: Blob | ArrayBuffer | Uint8Array): Blob {
  if (media instanceof Blob) {
    return media;
  }

  const body = media instanceof ArrayBuffer
    ? media
    : media.buffer.slice(media.byteOffset, media.byteOffset + media.byteLength) as ArrayBuffer;
  return new Blob([body]);
}

function normalizeArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }

  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }

  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer as ArrayBuffer;
  }

  throw new Error('Unexpected media response type from HTTP executor');
}

type WechatApiFeature =
  | 'qrcode'
  | 'shorten'
  | 'template'
  | 'customer_service'
  | 'datacube_article'
  | 'generic';

function wechatErrcode(data: unknown): number {
  const raw = (data as { errcode?: unknown } | null)?.errcode;
  if (raw === undefined || raw === null || raw === '') {
    return 0;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function wechatErrmsg(data: unknown): string {
  const errmsg = (data as { errmsg?: unknown } | null)?.errmsg;
  return typeof errmsg === 'string' && errmsg.trim() ? errmsg : 'unknown error';
}

function wechatApiDiagnostic(errcode: number, feature: WechatApiFeature = 'generic'): string {
  if (errcode === 48001) {
    const featureLabel = {
      qrcode: '带参数二维码接口（官方适用范围：认证服务号）',
      shorten: '长信息与短链接口（官方适用范围：认证服务号）',
      template: '模板消息接口（官方适用范围：认证服务号）',
      customer_service: '客服接口（公众号/服务号需认证，且后台客服能力需可用）',
      datacube_article: '数据统计接口（官方适用范围：认证服务号）',
      generic: '当前接口',
    }[feature];
    return `诊断: 微信返回 api unauthorized。请确认${featureLabel}已对当前公众号开通/授权；若账号未企业认证或未拥有对应权限集，代码重试不会成功。`;
  }

  if (errcode === 65400) {
    return '诊断: 微信客服能力不可用。请在微信公众平台启用新版客服/客服消息能力，并等待能力生效后重试。';
  }

  if (errcode === 47009) {
    return '诊断: 微信返回该旧图文统计接口已下线。请改用 get_article_read、get_article_share、get_biz_summary 或 get_article_total_detail。';
  }

  if (errcode === 61501) {
    return '诊断: 日期范围超过官方接口限制，请按对应接口限制缩短 beginDate/endDate。';
  }

  return '';
}

function assertWechatOk(data: unknown, operation: string, feature: WechatApiFeature = 'generic'): void {
  const errcode = wechatErrcode(data);
  if (errcode === 0) {
    return;
  }

  const diagnostic = wechatApiDiagnostic(errcode, feature);
  throw new Error(`${operation} failed: ${wechatErrmsg(data)} (${errcode})${diagnostic ? `. ${diagnostic}` : ''}`);
}

function featureForPath(path: string): WechatApiFeature {
  if (path.includes('/qrcode/')) return 'qrcode';
  if (path.includes('/shorten/')) return 'shorten';
  if (path.includes('/template/') || path.includes('/message/template/')) return 'template';
  if (path.includes('/customservice/') || path.includes('/message/custom/')) return 'customer_service';
  if (path.includes('/datacube/')) return 'datacube_article';
  return 'generic';
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function normalizeTemplate(template: Record<string, unknown>): {
  templateId: string;
  title: string;
  content: string;
  example: string;
  primaryIndustry?: string;
  deputyIndustry?: string;
} {
  return {
    templateId: pickString(template, 'template_id', 'templateId'),
    title: pickString(template, 'title'),
    content: pickString(template, 'content'),
    example: pickString(template, 'example'),
    primaryIndustry: pickString(template, 'primary_industry', 'primaryIndustry'),
    deputyIndustry: pickString(template, 'deputy_industry', 'deputyIndustry'),
  };
}

function normalizeIndustry(industry: unknown): { firstClass: string; secondClass: string } {
  const record = (industry ?? {}) as Record<string, unknown>;
  return {
    firstClass: pickString(record, 'first_class', 'firstClass'),
    secondClass: pickString(record, 'second_class', 'secondClass'),
  };
}

function normalizeCustomMessagePayload(data: Record<string, any>): Record<string, any> {
  const payload: Record<string, any> = {
    touser: data.touser,
    msgtype: data.msgtype,
  };

  const mapMedia = (value?: { mediaId?: string }) => value ? { media_id: value.mediaId } : undefined;

  if (data.text) payload.text = data.text;
  if (data.image) payload.image = mapMedia(data.image);
  if (data.voice) payload.voice = mapMedia(data.voice);
  if (data.video) {
    payload.video = {
      media_id: data.video.mediaId,
      thumb_media_id: data.video.thumbMediaId,
      title: data.video.title,
      description: data.video.description,
    };
  }
  if (data.music) {
    payload.music = {
      title: data.music.title,
      description: data.music.description,
      musicurl: data.music.musicurl,
      hqmusicurl: data.music.hqmusicurl,
      thumb_media_id: data.music.thumbMediaId,
    };
  }
  if (data.news) payload.news = data.news;
  if (data.mpnews) payload.mpnews = mapMedia(data.mpnews);
  if (data.wxcard) payload.wxcard = { card_id: data.wxcard.cardId };

  return JSON.parse(JSON.stringify(payload));
}

/**
 * 微信公众号 API 客户端
 * 封装微信公众号 API 调用
 */
export class WechatApiClient {
  private authManager: WechatAuthManagerLike;
  private httpClient: HttpExecutor;
  private inboxStore?: InboxStore;

  constructor(authManager: WechatAuthManagerLike, optionsOrExecutor?: HttpExecutor | WechatApiClientOptions) {
    this.authManager = authManager;
    const options = normalizeClientOptions(optionsOrExecutor);
    this.inboxStore = options.inboxStore;
    if (!options.httpExecutor) {
      throw new Error('HTTP-only WechatApiClient requires an explicit HttpExecutor (WorkersHttpExecutor wrapped with AccessTokenHttpExecutor).');
    }
    this.httpClient = options.httpExecutor;
  }

  getAuthManager(): WechatAuthManagerLike {
    return this.authManager;
  }

  getInboxStore(): InboxStore | undefined {
    return this.inboxStore;
  }

  private async withTransientRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= 2 || !this.isTransientNetworkError(error)) {
          throw error;
        }
        logger.warn(`${operation} transient network failure, retrying once:`, (error as any)?.message ?? String(error));
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    throw lastError;
  }

  private isTransientNetworkError(error: unknown): boolean {
    const message = ((error as any)?.message ?? String(error)).toLowerCase();
    return [
      'fetch failed',
      'network',
      'econnreset',
      'etimedout',
      'tls',
      'disconnect',
      'aborted',
    ].some(marker => message.includes(marker));
  }

  /**
   * 上传临时素材
   */
  async uploadMedia(params: {
    type: 'image' | 'voice' | 'video' | 'thumb';
    media: Blob | ArrayBuffer | Uint8Array;
    fileName: string;
    title?: string;
    introduction?: string;
  }): Promise<{ mediaId: string; type: string; createdAt: number; url?: string }> {
    try {
      const formData = new FormData();
      formData.append('media', toBlobPart(params.media), params.fileName);
      
      if (params.type === 'video') {
        const description = {
          title: params.title || 'Video',
          introduction: params.introduction || '',
        };
        formData.append('description', JSON.stringify(description));
      }

      const response = await this.httpClient.postForm(
        `/cgi-bin/media/upload?type=${params.type}`,
        formData,
        formHeadersConfig(formData)
      );

      if (response.data.errcode) {
        throw new Error(`Upload failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return {
        mediaId: response.data.media_id,
        type: response.data.type,
        createdAt: response.data.created_at * 1000,
        url: response.data.url,
      };
    } catch (error) {
      logger.error('Failed to upload media:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取临时素材
   */
  async getMedia(mediaId: string): Promise<ArrayBuffer> {
    try {
      const response = await this.httpClient.get(
        `/cgi-bin/media/get?media_id=${mediaId}`,
        {
          responseType: 'arraybuffer',
        }
      );

      return normalizeArrayBuffer(response.data);
    } catch (error) {
      logger.error('Failed to get media:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 新增永久图文素材
   */
  async addNews(articles: Array<{
    title: string;
    author?: string;
    digest?: string;
    content: string;
    contentSourceUrl?: string;
    thumbMediaId: string;
    showCoverPic?: number;
    needOpenComment?: number;
    onlyFansCanComment?: number;
  }>): Promise<{ mediaId: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/material/add_news', {
        articles: articles.map(article => ({
          title: article.title,
          author: article.author || '',
          digest: article.digest || '',
          content: article.content,
          content_source_url: article.contentSourceUrl || '',
          thumb_media_id: article.thumbMediaId,
          show_cover_pic: article.showCoverPic || 0,
          need_open_comment: article.needOpenComment || 0,
          only_fans_can_comment: article.onlyFansCanComment || 0,
        })),
      });

      if (response.data.errcode) {
        throw new Error(`Add news failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return {
        mediaId: response.data.media_id,
      };
    } catch (error) {
      logger.error('Failed to add news:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 新增草稿
   */
  async addDraft(articles: Array<{
    title: string;
    author?: string;
    digest?: string;
    content: string;
    contentSourceUrl?: string;
    thumbMediaId: string;
    showCoverPic?: number;
    needOpenComment?: number;
    onlyFansCanComment?: number;
  }>): Promise<{ mediaId: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/draft/add', {
        articles,
      });

      if (response.data.errcode) {
        throw new Error(`Add draft failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return {
        mediaId: response.data.media_id,
      };
    } catch (error) {
      logger.error('Failed to add draft:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 发布接口
   */
  async publishDraft(mediaId: string): Promise<{ publishId: string; msgDataId: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/freepublish/submit', {
        media_id: mediaId,
      });

      if (response.data.errcode) {
        throw new Error(`Publish failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return {
        publishId: response.data.publish_id,
        msgDataId: response.data.msg_data_id,
      };
    } catch (error) {
      logger.error('Failed to publish draft:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 上传图文消息图片
   */
  async uploadImg(formData: unknown): Promise<{ url: string; errcode?: number; errmsg?: string }> {
    try {
      const response = await this.httpClient.postForm(
        '/cgi-bin/media/uploadimg',
        formData,
        formHeadersConfig(formData)
      );

      return response.data;
    } catch (error) {
      logger.error('Failed to upload image:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 通用 GET 请求
   */
  async get(path: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.httpClient.get(path, { params });
      
      assertWechatOk(response.data, 'GET API', featureForPath(path));
      
      return response.data;
    } catch (error) {
      logger.error(`GET ${path} failed:`, (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 通用 POST 请求
   */
  async post(path: string, data?: unknown): Promise<unknown> {
    try {
      const response = await this.httpClient.post(path, data);

      assertWechatOk(response.data, 'POST API', featureForPath(path));

      return response.data;
    } catch (error) {
      logger.error(`POST ${path} failed:`, (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 通用 multipart/form-data POST 请求
   */
  async postForm(path: string, formData: unknown): Promise<unknown> {
    try {
      const response = await this.httpClient.postForm(path, formData, formHeadersConfig(formData));

      assertWechatOk(response.data, 'POST form API', featureForPath(path));

      return response.data;
    } catch (error) {
      logger.error(`POST form ${path} failed:`, (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 用户管理 API ====================

  /**
   * 获取用户列表
   */
  async getUserList(nextOpenId?: string): Promise<{
    total: number;
    count: number;
    data: { openid: string[] };
    nextOpenid: string;
  }> {
    try {
      const params = nextOpenId ? { next_openid: nextOpenId } : {};
      const response = await this.httpClient.get('/cgi-bin/user/get', { params });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get user list failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get user list:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取用户基本信息
   */
  async getUserInfo(openId: string, lang: 'zh_CN' | 'zh_TW' | 'en' = 'zh_CN'): Promise<{
    subscribe: number;
    openid: string;
    nickname: string;
    sex: number;
    language: string;
    city: string;
    province: string;
    country: string;
    headImgUrl: string;
    subscribeTime: number;
    unionId?: string;
    remark?: string;
    groupId?: number;
    tagidList?: number[];
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/user/info', {
        params: { openid: openId, lang }
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get user info failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get user info:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 批量获取用户信息
   */
  async batchGetUserInfo(userList: string[], lang: 'zh_CN' | 'zh_TW' | 'en' = 'zh_CN'): Promise<{
    user_info_list: Array<{
      subscribe: number;
      openid: string;
      nickname: string;
      sex: number;
      language: string;
      city: string;
      province: string;
      country: string;
      headImgUrl: string;
      subscribeTime: number;
      unionId?: string;
      remark?: string;
      groupId?: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/user/info/batchget', {
        user_list: userList.map(openid => ({ openid, lang }))
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Batch get user info failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to batch get user info:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 设置用户备注名
   */
  async updateUserRemark(openId: string, remark: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/user/info/updateremark', {
        openid: openId,
        remark
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Update user remark failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to update user remark:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取用户增减数据
   */
  async getUserSummary(beginDate: string, endDate: string): Promise<{
    list: Array<{
      ref_date: string;
      user_source: number;
      new_user: number;
      cancel_user: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/datacube/getusersummary', {
        begin_date: beginDate,
        end_date: endDate,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get user summary failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get user summary:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取累计用户数据
   */
  async getUserCumulate(beginDate: string, endDate: string): Promise<{
    list: Array<{
      ref_date: string;
      cumulate_user: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/datacube/getusercumulate', {
        begin_date: beginDate,
        end_date: endDate,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get user cumulate failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get user cumulate:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 标签管理 API ====================

  /**
   * 创建标签
   */
  async createTag(name: string): Promise<{ tag: { id: number; name: string } }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/create', { tag: { name } });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Create tag failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to create tag:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取标签列表
   */
  async getTags(): Promise<{ tags: Array<{ id: number; name: string; count: number }> }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/tags/get');

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get tags failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get tags:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 编辑标签
   */
  async updateTag(tagId: number, name: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/update', { tag: { id: tagId, name } });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Update tag failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to update tag:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除标签
   */
  async deleteTag(tagId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/delete', { tag: { id: tagId } });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete tag failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete tag:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 批量为用户打标签
   */
  async batchTagging(openIdList: string[], tagId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/members/batchtagging', {
        openid_list: openIdList,
        tagid: tagId
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Batch tagging failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to batch tagging:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 批量为用户取消标签
   */
  async batchUntagging(openIdList: string[], tagId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/members/batchuntagging', {
        openid_list: openIdList,
        tagid: tagId
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Batch untagging failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to batch untagging:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取标签下用户列表
   */
  async getTagUsers(tagId: string, nextOpenId?: string): Promise<{
    count: number;
    data: { openid: string[] };
    next_openid: string;
  }> {
    try {
      const params: any = { tagid: tagId };
      if (nextOpenId) params.next_openid = nextOpenId;

      const response = await this.httpClient.post('/cgi-bin/user/tag/get', params);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get tag users failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get tag users:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 自定义菜单 API ====================

  /**
   * 创建自定义菜单
   */
  async createMenu(menuData: {
    button: Array<{
      type?: string;
      name: string;
      key?: string;
      url?: string;
      mediaId?: string;
      sub_button?: Array<any>;
    }>;
  }): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.withTransientRetry('Create menu', () =>
        this.httpClient.post('/cgi-bin/menu/create', menuData)
      );

      assertWechatOk(response.data, 'Create menu');

      return response.data;
    } catch (error) {
      logger.error('Failed to create menu:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 查询自定义菜单
   */
  async getMenu(): Promise<{
    menu: {
      button: Array<any>;
    };
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/menu/get');

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get menu failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get menu:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除自定义菜单
   */
  async deleteMenu(): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/menu/delete');

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete menu failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete menu:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 创建个性化菜单
   */
  async addConditionalMenu(menuData: {
    button: Array<any>;
    matchrule: {
      tag_id?: number;
      sex?: string;
      country?: string;
      province?: string;
      city?: string;
      client_platform_type?: number;
      language?: string;
    };
  }): Promise<{ menuid: number; errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/menu/addconditional', menuData);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Add conditional menu failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to add conditional menu:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除个性化菜单
   */
  async deleteConditionalMenu(menuId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/menu/delconditional', { menuid: menuId });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete conditional menu failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete conditional menu:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取自定义菜单配置
   */
  async getSelfMenuInfo(): Promise<{
    selfmenu_info: {
      button: Array<any>;
    };
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/get_current_selfmenu_info');

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get self menu info failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get self menu info:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 模板消息 API ====================

  /**
   * 发送模板消息
   */
  async sendTemplateMessage(data: {
    touser: string;
    templateId: string;
    url?: string;
    topcolor?: string;
    data: Record<string, { value: string; color?: string }>;
  }): Promise<{ errcode: number; errmsg: string; msgid: number }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/template/send', {
        touser: data.touser,
        template_id: data.templateId,
        url: data.url,
        topcolor: data.topcolor,
        data: data.data,
      });

      assertWechatOk(response.data, 'Send template message', 'template');

      return response.data;
    } catch (error) {
      logger.error('Failed to send template message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取模板列表
   */
  async getAllPrivateTemplates(): Promise<{
    template_list: Array<{
      templateId: string;
      title: string;
      content: string;
      example: string;
    }>;
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/template/get_all_private_template');

      assertWechatOk(response.data, 'Get templates', 'template');

      return {
        ...response.data,
        template_list: (response.data.template_list ?? []).map((template: Record<string, unknown>) => normalizeTemplate(template)),
      };
    } catch (error) {
      logger.error('Failed to get templates:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除模板
   */
  async deletePrivateTemplate(templateId: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/template/del_private_template', {
        template_id: templateId
      });

      assertWechatOk(response.data, 'Delete template', 'template');

      return response.data;
    } catch (error) {
      logger.error('Failed to delete template:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取行业信息
   */
  async getTemplateIndustry(): Promise<{
    primary_industry: { firstClass: string; secondClass: string };
    secondary_industry: { firstClass: string; secondClass: string };
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/template/get_industry');

      assertWechatOk(response.data, 'Get template industry', 'template');

      return {
        primary_industry: normalizeIndustry(response.data.primary_industry),
        secondary_industry: normalizeIndustry(response.data.secondary_industry),
      };
    } catch (error) {
      logger.error('Failed to get template industry:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 客服消息 API ====================

  /**
   * 发送客服消息
   */
  async sendCustomMessage(data: {
    touser: string;
    msgtype: 'text' | 'image' | 'voice' | 'video' | 'music' | 'news' | 'mpnews' | 'wxcard';
    text?: { content: string };
    image?: { mediaId: string };
    voice?: { mediaId: string };
    video?: { mediaId: string; thumbMediaId: string; title?: string; description?: string };
    music?: { title: string; description: string; musicurl: string; hqmusicurl: string; thumbMediaId?: string };
    news?: { articles: Array<any> };
    mpnews?: { mediaId: string };
    wxcard?: { cardId: string };
  }): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/custom/send', normalizeCustomMessagePayload(data));

      assertWechatOk(response.data, 'Send custom message', 'customer_service');

      return response.data;
    } catch (error) {
      logger.error('Failed to send custom message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取客服聊天记录
   */
  async getCustomMessageRecords(startTime: number, endTime: number, msgId?: number, number?: number): Promise<{
    records: Array<{
      worker: string;
      openid: string;
      opercode: number;
      time: number;
      text: string;
    }>;
    number?: number;
    msgid?: number;
    errmsg: string;
    errcode: number;
  }> {
    try {
      const data: any = {
        starttime: startTime,
        endtime: endTime
      };
      if (msgId !== undefined) data.msgid = msgId;
      if (number !== undefined) data.number = number;

      const response = await this.httpClient.post('/customservice/msgrecord/getmsglist', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get custom message records failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return {
        ...response.data,
        records: response.data.recordlist ?? response.data.records ?? [],
      };
    } catch (error) {
      logger.error('Failed to get custom message records:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 数据统计 API ====================

  private async getDatacubeData(path: string, beginDate: string, endDate: string, operation: string): Promise<{
    list: Array<Record<string, unknown>>;
    is_delay?: boolean;
    isDelay?: boolean;
  }> {
    const response = await this.httpClient.post(path, {
      begin_date: beginDate,
      end_date: endDate,
    });

    assertWechatOk(response.data, operation, 'datacube_article');

    return response.data;
  }

  /**
   * 获取发表内容每日阅读数据（官方替代旧 getarticlesummary/getuserread）
   */
  async getArticleRead(beginDate: string, endDate: string): Promise<{
    list: Array<Record<string, unknown>>;
    is_delay?: boolean;
  }> {
    try {
      return await this.getDatacubeData('/datacube/getarticleread', beginDate, endDate, 'Get article read');
    } catch (error) {
      logger.error('Failed to get article read:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取发表内容每日分享数据（官方替代旧 getusershare）
   */
  async getArticleShare(beginDate: string, endDate: string): Promise<{
    list: Array<Record<string, unknown>>;
    is_delay?: boolean;
  }> {
    try {
      return await this.getDatacubeData('/datacube/getarticleshare', beginDate, endDate, 'Get article share');
    } catch (error) {
      logger.error('Failed to get article share:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取发表内容概况总数据（官方替代旧图文概况统计）
   */
  async getBizSummary(beginDate: string, endDate: string): Promise<{
    list: Array<Record<string, unknown>>;
    is_delay?: boolean;
  }> {
    try {
      return await this.getDatacubeData('/datacube/getbizsummary', beginDate, endDate, 'Get biz summary');
    } catch (error) {
      logger.error('Failed to get biz summary:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取发表内容发表详细数据（官方替代旧 getarticletotal）
   */
  async getArticleTotalDetail(beginDate: string, endDate: string): Promise<{
    list: Array<Record<string, unknown>>;
    is_delay?: boolean;
  }> {
    try {
      return await this.getDatacubeData('/datacube/getarticletotaldetail', beginDate, endDate, 'Get article total detail');
    } catch (error) {
      logger.error('Failed to get article total detail:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * @deprecated 官方旧接口已停止维护；兼容路由到 getArticleRead。
   */
  async getArticleSummary(beginDate: string, endDate: string): Promise<{ list: Array<Record<string, unknown>>; is_delay?: boolean }> {
    return this.getArticleRead(beginDate, endDate);
  }

  /**
   * @deprecated 官方旧接口已停止维护；兼容路由到 getArticleTotalDetail。
   */
  async getArticleTotal(beginDate: string, endDate: string): Promise<{ list: Array<Record<string, unknown>>; is_delay?: boolean }> {
    return this.getArticleTotalDetail(beginDate, endDate);
  }

  /**
   * @deprecated 官方旧接口已停止维护；兼容路由到 getArticleRead。
   */
  async getUserRead(beginDate: string, endDate: string): Promise<{ list: Array<Record<string, unknown>>; is_delay?: boolean }> {
    return this.getArticleRead(beginDate, endDate);
  }

  /**
   * @deprecated 官方旧接口已停止维护；兼容路由到 getArticleShare。
   */
  async getUserShare(beginDate: string, endDate: string): Promise<{ list: Array<Record<string, unknown>>; is_delay?: boolean }> {
    return this.getArticleShare(beginDate, endDate);
  }

  /**
   * 获取消息发送概况数据
   */
  async getUpstreamMessage(beginDate: string, endDate: string): Promise<{
    list: Array<{
      refDate: string;
      msgType: number;
      msgUser: number;
      msgCount: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/datacube/getupstreammsg', {
        begin_date: beginDate,
        end_date: endDate,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get upstream message failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get upstream message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取接口分析数据
   */
  async getInterfaceSummary(beginDate: string, endDate: string): Promise<{
    list: Array<{
      refDate: string;
      callbackCount: number;
      failCount: number;
      totalTime: number;
      maxTime: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/datacube/getinterfacesummary', {
        begin_date: beginDate,
        end_date: endDate,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get interface summary failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get interface summary:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取接口分析分时数据
   */
  async getInterfaceSummaryHour(beginDate: string, endDate: string): Promise<{
    list: Array<{
      refDate: string;
      refHour: number;
      callbackCount: number;
      failCount: number;
      totalTime: number;
      maxTime: number;
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/datacube/getinterfacesummaryhour', {
        begin_date: beginDate,
        end_date: endDate,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get interface summary hour failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get interface summary hour:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 自动回复 API ====================

  /**
   * 获取自动回复规则
   */
  async getCurrentAutoReplyInfo(): Promise<{
    isAddFriendReply: boolean;
    isAutoReply: boolean;
    addFriendReplyInfo: {
      type: string;
      content: string;
    };
    defaultMessageReplyInfoList: Array<{
      type: string;
      content: string;
    }>;
    keywordAutoreplyInfoList: Array<{
      keyword: string;
      matchMode: number;
      replyListInfo: Array<any>;
    }>;
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/get_current_autoreply_info');

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get auto reply info failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get auto reply info:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 群发消息 API ====================

  /**
   * 根据标签进行群发
   */
  async sendMassMessageByTag(data: {
    filter: { isToAll: boolean; tagId?: number };
    mpnews?: { mediaId: string };
    msgtype: 'mpnews' | 'text' | 'voice' | 'image' | 'mpvideo' | 'wxcard';
    text?: { content: string };
    voice?: { mediaId: string };
    image?: { mediaId: string };
    mpvideo?: { mediaId: string };
    wxcard?: { cardId: string };
    sendIgnoreReprint?: number;
  }): Promise<{ errcode: number; errmsg: string; msgId: number; msgDataId: number }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/mass/sendall', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Send mass message failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to send mass message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 根据OpenID列表群发
   */
  async sendMassMessageByOpenId(data: {
    touser: string[];
    mpnews?: { mediaId: string };
    msgtype: 'mpnews' | 'text' | 'voice' | 'image' | 'mpvideo' | 'wxcard';
    text?: { content: string };
    voice?: { mediaId: string };
    image?: { mediaId: string };
    mpvideo?: { mediaId: string };
    wxcard?: { cardId: string };
    sendIgnoreReprint?: number;
  }): Promise<{ errcode: number; errmsg: string; msgId: number; msgDataId: number }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/mass/send', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Send mass message by openid failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to send mass message by openid:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除群发
   */
  async deleteMassMessage(msgId: number, articleIdx?: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const data: any = { msgId };
      if (articleIdx !== undefined) data.articleIdx = articleIdx;

      const response = await this.httpClient.post('/cgi-bin/message/mass/delete', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete mass message failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete mass message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 预览接口
   */
  async previewMassMessage(data: {
    touser: string;
    mpnews?: { mediaId: string };
    msgtype: 'mpnews' | 'text' | 'voice' | 'image' | 'mpvideo' | 'wxcard';
    text?: { content: string };
    voice?: { mediaId: string };
    image?: { mediaId: string };
    mpvideo?: { mediaId: string };
    wxcard?: { cardId: string };
  }): Promise<{ errcode: number; errmsg: string; msgId: number }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/mass/preview', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Preview mass message failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to preview mass message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 订阅通知 API ====================

  /**
   * 发送订阅通知
   */
  async sendSubscribeMessage(data: {
    touser: string;
    template_id: string;
    page?: string;
    miniprogram?: { appid: string; pagepath: string };
    miniprogram_state?: 'developer' | 'trial' | 'formal';
    lang?: 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW';
    client_msg_id?: string;
    data: Record<string, { value: string }>;
  }): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/message/subscribe/bizsend', data);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Send subscribe message failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to send subscribe message:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 二维码管理 API ====================

  /**
   * 创建二维码 Ticket
   */
  async createQrCode(data: {
    expireSeconds?: number;
    actionName: 'QR_SCENE' | 'QR_STR_SCENE' | 'QR_LIMIT_SCENE' | 'QR_LIMIT_STR_SCENE';
    sceneId?: number;
    sceneStr?: string;
  }): Promise<{ ticket: string; expireSeconds?: number; url: string }> {
    try {
      const scene: Record<string, unknown> = {};
      if (data.sceneId !== undefined) scene.scene_id = data.sceneId;
      if (data.sceneStr !== undefined) scene.scene_str = data.sceneStr;

      const requestData: Record<string, unknown> = {
        action_name: data.actionName,
        action_info: { scene },
      };
      if (data.expireSeconds !== undefined) requestData.expire_seconds = data.expireSeconds;

      const response = await this.httpClient.post('/cgi-bin/qrcode/create', requestData);

      assertWechatOk(response.data, 'Create QR code', 'qrcode');

      return {
        ticket: response.data.ticket,
        expireSeconds: response.data.expire_seconds,
        url: response.data.url,
      };
    } catch (error) {
      logger.error('Failed to create QR code:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 通过 Ticket 换取二维码图片 URL
   */
  getQrCodeUrl(ticket: string): string {
    return `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(ticket)}`;
  }

  // ==================== 短链接 API ====================

  /**
   * 长信息转短 key（微信官方新版“长信息与短链”接口）
   */
  async generateShortKey(longData: string, expireSeconds: number = 2592000): Promise<{ shortKey: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/shorten/gen', {
        long_data: longData,
        expire_seconds: expireSeconds,
      });

      assertWechatOk(response.data, 'Generate short key', 'shorten');

      return { shortKey: response.data.short_key };
    } catch (error) {
      logger.error('Failed to generate short key:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 短 key 还原长信息
   */
  async fetchShortKey(shortKey: string): Promise<{
    longData: string;
    createTime?: number;
    expireSeconds?: number;
  }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/shorten/fetch', {
        short_key: shortKey,
      });

      assertWechatOk(response.data, 'Fetch short key', 'shorten');

      return {
        longData: response.data.long_data,
        createTime: response.data.create_time,
        expireSeconds: response.data.expire_seconds,
      };
    } catch (error) {
      logger.error('Failed to fetch short key:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * @deprecated 微信官方旧 URL Shortener 文档已升级为“长信息与短链”。
   * 保留该方法仅为兼容旧调用方；返回值中的 shortUrl 实际为 short_key。
   */
  async shortUrl(longUrl: string): Promise<{ shortUrl: string; shortKey: string }> {
    const result = await this.generateShortKey(longUrl);
    return { shortUrl: result.shortKey, shortKey: result.shortKey };
  }

  // ==================== 评论管理 API ====================

  /**
   * 打开已群发文章评论
   */
  async openComment(msgDataId: number, index: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/open', {
        msg_data_id: msgDataId,
        index,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Open comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to open comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 关闭已群发文章评论
   */
  async closeComment(msgDataId: number, index: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/close', {
        msg_data_id: msgDataId,
        index,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Close comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to close comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 查看指定文章的评论列表
   */
  async getCommentList(msgDataId: number, index: number, begin: number, count: number, type: number): Promise<{
    total: number;
    comment: Array<{
      userCommentId: number;
      createTime: number;
      content: string;
      commentType: number;
      openid: string;
      reply?: {
        content: string;
        createTime: number;
      };
    }>;
  }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/list', {
        msg_data_id: msgDataId,
        index,
        begin,
        count,
        type,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get comment list failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get comment list:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 标记为精选评论
   */
  async markElectComment(msgDataId: number, index: number, userCommentId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/markelect', {
        msg_data_id: msgDataId,
        index,
        user_comment_id: userCommentId,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Mark elect comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to mark elect comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 取消精选评论
   */
  async unmarkElectComment(msgDataId: number, index: number, userCommentId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/unmarkelect', {
        msg_data_id: msgDataId,
        index,
        user_comment_id: userCommentId,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Unmark elect comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to unmark elect comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除评论
   */
  async deleteComment(msgDataId: number, index: number, userCommentId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/delete', {
        msg_data_id: msgDataId,
        index,
        user_comment_id: userCommentId,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 回复评论
   */
  async replyComment(msgDataId: number, index: number, userCommentId: number, content: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/reply/add', {
        msg_data_id: msgDataId,
        index,
        user_comment_id: userCommentId,
        content,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Reply comment failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to reply comment:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除评论回复
   */
  async deleteCommentReply(msgDataId: number, index: number, userCommentId: number, replyId: number): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/comment/reply/delete', {
        msg_data_id: msgDataId,
        index,
        user_comment_id: userCommentId,
        reply_id: replyId,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Delete comment reply failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to delete comment reply:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 黑名单管理 API ====================

  /**
   * 获取黑名单列表
   */
  async getBlackList(beginOpenId?: string): Promise<{
    total: number;
    count: number;
    data: { openid: string[] };
    next_openid: string;
  }> {
    try {
      const requestData: Record<string, unknown> = {};
      if (beginOpenId) requestData.begin_openid = beginOpenId;

      const response = await this.httpClient.post('/cgi-bin/tags/members/getblacklist', requestData);

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get blacklist failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get blacklist:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 拉黑用户
   */
  async batchBlackList(openIdList: string[]): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/members/batchblacklist', {
        openid_list: openIdList,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Batch blacklist failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to batch blacklist:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 取消拉黑用户
   */
  async batchUnBlackList(openIdList: string[]): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/tags/members/batchunblacklist', {
        openid_list: openIdList,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Batch unblacklist failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to batch unblacklist:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 客服账号管理 API ====================

  /**
   * 添加客服账号
   */
  async addKfAccount(kfAccount: string, nickname: string, password: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/customservice/kfaccount/add', {
        kf_account: kfAccount,
        nickname,
        password,
      });

      assertWechatOk(response.data, 'Add kf account', 'customer_service');

      return response.data;
    } catch (error) {
      logger.error('Failed to add kf account:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 修改客服账号
   */
  async updateKfAccount(kfAccount: string, nickname: string, password: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/customservice/kfaccount/update', {
        kf_account: kfAccount,
        nickname,
        password,
      });

      assertWechatOk(response.data, 'Update kf account', 'customer_service');

      return response.data;
    } catch (error) {
      logger.error('Failed to update kf account:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 删除客服账号
   */
  async deleteKfAccount(kfAccount: string): Promise<{ errcode: number; errmsg: string }> {
    try {
      const response = await this.httpClient.post('/customservice/kfaccount/del', {
        kf_account: kfAccount,
      });

      assertWechatOk(response.data, 'Delete kf account', 'customer_service');

      return response.data;
    } catch (error) {
      logger.error('Failed to delete kf account:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 获取客服列表
   */
  async getKfList(): Promise<{
    kf_list: Array<{
      kf_account: string;
      kf_nick: string;
      kf_id: string;
      kf_headimgurl: string;
    }>;
  }> {
    try {
      const response = await this.httpClient.get('/cgi-bin/customservice/getkflist');

      assertWechatOk(response.data, 'Get kf list', 'customer_service');

      return response.data;
    } catch (error) {
      logger.error('Failed to get kf list:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  // ==================== 账号管理 API ====================

  /**
   * 重置 API 调用次数
   */
  async clearQuota(): Promise<{ errcode: number; errmsg: string }> {
    try {
      const config = await this.authManager.getConfig();
      if (!config?.appId) {
        throw new Error('WeChat AppID is not configured');
      }
      const response = await this.httpClient.post('/cgi-bin/clear_quota', {
        appid: config.appId,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Clear quota failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to clear quota:', (error as any)?.message ?? String(error));
      throw error;
    }
  }

  /**
   * 查询 API 调用次数配额
   */
  async getApiQuota(cgiPath: string): Promise<{
    quota: {
      daily_limit: number;
      used: number;
      remain: number;
    };
  }> {
    try {
      const response = await this.httpClient.post('/cgi-bin/openapi/quota/get', {
        cgi_path: cgiPath,
      });

      if (response.data.errcode && response.data.errcode !== 0) {
        throw new Error(`Get API quota failed: ${response.data.errmsg} (${response.data.errcode})`);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to get API quota:', (error as any)?.message ?? String(error));
      throw error;
    }
  }
}

/**
 * 微信公众号 REST API 路由
 * 将 15 个 MCP 工具暴露为 HTTP REST 端点
 */

import { Router, Request, Response } from 'express';
import { AuthManager } from '../../src/auth/auth-manager.js';
import { WechatMcpTool } from '../../src/mcp-tool/index.js';
import { logger } from '../../src/utils/logger.js';
import { mcpTools } from '../../src/mcp-tool/tools/index.js';
import { WechatToolResult } from '../../src/mcp-tool/types.js';

const router = Router();

let authManager: AuthManager | null = null;
let wechatTool: WechatMcpTool | null = null;
let initPromise: Promise<void> | null = null;

/**
 * 初始化 AuthManager 和 WechatMcpTool
 */
async function doInitialize(): Promise<void> {
  authManager = new AuthManager();
  await authManager.initialize();

  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (appId && appSecret) {
    await authManager.setConfig({ appId, appSecret });
    logger.info('WeChat REST API: Config loaded from environment variables');
  }

  wechatTool = new WechatMcpTool(authManager);
  wechatTool.initialize();
}

/**
 * 确保已初始化（单例模式）
 */
async function ensureInitialized(): Promise<void> {
  if (authManager && wechatTool) {
    return;
  }
  if (!initPromise) {
    initPromise = doInitialize().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/**
 * 将 MCP 工具结果转换为 REST API 友好格式
 */
function transformResult(result: WechatToolResult): {
  success: boolean;
  text: string | string[];
  media?: Array<{
    type: string;
    uri?: string;
    mimeType?: string;
    data?: string;
  }>;
  raw: WechatToolResult;
} {
  const textContents = result.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string);

  const mediaContents = result.content
    .filter((c) => c.type === 'image' || c.type === 'resource')
    .map((c) => ({
      type: c.type,
      uri: c.uri,
      mimeType: c.mimeType,
      data: c.data,
    }));

  return {
    success: !result.isError,
    text: textContents.length === 1 ? textContents[0] : textContents,
    media: mediaContents.length > 0 ? mediaContents : undefined,
    raw: result,
  };
}

/**
 * GET /api/wechat/tools
 * 列出所有可用工具
 */
router.get('/tools', async (_req: Request, res: Response) => {
  try {
    await ensureInitialized();

    const tools = mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: Object.keys(tool.inputSchema),
    }));

    res.json({
      success: true,
      count: tools.length,
      tools,
    });
  } catch (error) {
    logger.error('Failed to list tools:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/wechat/tools/:toolName
 * 调用指定 MCP 工具
 */
router.post('/tools/:toolName', async (req: Request, res: Response) => {
  try {
    await ensureInitialized();

    if (!authManager!.isConfigured()) {
      res.status(400).json({
        success: false,
        error:
          'WeChat not configured. Please call POST /api/wechat/config first with appId and appSecret.',
      });
      return;
    }

    const { toolName } = req.params;
    const args = req.body;

    logger.info(`REST API calling tool: ${toolName}`);

    const result = await wechatTool!.callTool(toolName, args);
    const response = transformResult(result);

    res.status(response.success ? 200 : 400).json(response);
  } catch (error) {
    logger.error(`REST API tool execution failed:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/wechat/config
 * 设置微信配置（AppID / AppSecret）
 */
router.post('/config', async (req: Request, res: Response) => {
  try {
    await ensureInitialized();

    const { appId, appSecret, token, encodingAESKey } = req.body;

    if (!appId || !appSecret) {
      res.status(400).json({
        success: false,
        error: 'appId and appSecret are required',
      });
      return;
    }

    await authManager!.setConfig({ appId, appSecret, token, encodingAESKey });

    // 重新创建 WechatMcpTool 以使用新的配置
    wechatTool = new WechatMcpTool(authManager!);
    wechatTool.initialize();

    res.json({
      success: true,
      message: 'WeChat configuration updated successfully',
      appId: appId.substring(0, 8) + '...',
    });
  } catch (error) {
    logger.error('Failed to set config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/wechat/config
 * 获取当前配置状态
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    await ensureInitialized();

    const config = await authManager!.getConfig();

    res.json({
      success: true,
      configured: authManager!.isConfigured(),
      appId: config?.appId ? config.appId.substring(0, 8) + '...' : null,
      hasToken: !!config?.token,
      hasEncodingAESKey: !!config?.encodingAESKey,
    });
  } catch (error) {
    logger.error('Failed to get config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/wechat/health
 * 健康检查（含微信连接状态）
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    await ensureInitialized();

    const configured = authManager!.isConfigured();
    let tokenStatus = 'not_configured';

    if (configured) {
      try {
        const tokenInfo = await authManager!.getAccessToken();
        const expiresIn = Math.floor((tokenInfo.expiresAt - Date.now()) / 1000);
        tokenStatus = expiresIn > 0 ? 'valid' : 'expired';
      } catch {
        tokenStatus = 'error';
      }
    }

    res.json({
      success: true,
      status: 'ok',
      wechat: {
        configured,
        tokenStatus,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

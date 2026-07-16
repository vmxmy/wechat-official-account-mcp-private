# AGENTS.md

> 本文件为 AI 编码助手提供项目背景、开发规范和操作指南。
> 项目的主要人类文档为中文，因此本文件以中文撰写。

---

## 项目概述

本项目是一个 **微信公众号 MCP (Model Context Protocol) 服务器**，为 Claude Desktop、Cursor、Trae AI 等 AI 应用提供微信公众号常用运营 API 工具集。

- **名称**: `wechat-official-account-mcp`
- **版本**: `v2.2.1`
- **作者**: xwang152-jack <xwang152@163.com>
- **许可证**: MIT
- **仓库**: https://github.com/xwang152-jack/wechat-official-account-mcp

**当前能力**: 27 个 MCP 工具（23 个微信公众号运营工具 + 4 个多租户管理工具），并提供 hosted Web 入口与 remote-only `@ziikoo/woa` CLI。API endpoint、字段名、签名算法和限制以 [WECHAT_OFFICIAL_API_CONTRACT.md](./WECHAT_OFFICIAL_API_CONTRACT.md) 及微信官方开发文档为唯一真源；不要使用“95%/100% 覆盖”等未经逐项核验的表述。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers + Node.js 18+ tooling | MCP 生产运行时为 Workers；Node 仅用于构建/测试/本地脚手架 |
| 语言 | TypeScript 5.8 | 严格模式关闭（开发配置） |
| 模块系统 | ES Modules (`"type": "module"`) | 所有导入必须使用 `.js` 扩展名 |
| 协议 | MCP SDK 1.29 | Model Context Protocol；仅保留 Streamable HTTP `/mcp` |
| 前端框架 | React 19 + TanStack Router/Query | hosted SaaS 登录、引导、计费、MCP 与安全页面 |
| 样式 | Astryx + 语义主题 CSS | Tailwind 仅保留为历史依赖，不用于新增 SaaS 页面 |
| 构建工具 | Vite 6 + `tsc` | 前端/Vite 与后端 TS 编译 |
| HTTP 客户端 | Workers `fetch` / Web FormData | `WorkersHttpExecutor`，支持 HTTPS relay 代理 |
| HTTP 服务器 | Cloudflare Workers Agents SDK | OAuth 保护的 Streamable HTTP `/mcp`、`/wx/callback` |
| 存储 | Cloudflare D1 / R2 / Durable Objects | D1 配置与业务表，R2 媒体输入，DO token/session |
| 参数校验 | Zod 4.4 | 工具输入 schema 定义与校验 |
| 加密 | crypto-js | D1 敏感字段 AES-256 加密（`enc:` 前缀） |
| 代码检查 | ESLint 9 + typescript-eslint | 含 React Hooks 规则 |

> 本地桌面端 `stdio` MCP transport、MCP-over-SSE、SQLite、Node/Axios executor、`filePath` 媒体上传实现均已移除。`@ziikoo/woa` 是只调用远程 Worker REST/OAuth/MCP 的 remote-only CLI，不恢复本地 MCP server。


## 官方 API Contract 真源

- 微信公众号 API 的 endpoint、请求字段、返回字段、签名算法、错误码和频率/权限限制，以微信官方开发文档为唯一真源。
- 本仓库维护本地核验记录：`WECHAT_OFFICIAL_API_CONTRACT.md`。新增或修改任何微信 API 调用前，先查该文件并重新打开对应官方文档。
- 已核验 contract 修正和后续 API 缺口以 `WECHAT_OFFICIAL_API_CONTRACT.md` 为准；不要恢复历史上未核验的 endpoint/字段。
- Cloudflare 迁移的 OpenSpec 参考：`openspec/changes/migrate-to-cloudflare-workers/wechat-official-api-contract.md`。

---

## 项目结构

```
wechat-official-account-mcp/
├── api/                          # 本地/ Vercel API 脚手架（非 MCP 传输）
├── migrations/d1/                # Cloudflare D1 migration
├── public/                       # 静态资源
├── scripts/
│   └── build.sh                  # 完整构建脚本（含校验）
├── src/
│   ├── index.ts                  # HTTP-only 库导出入口
│   ├── mcp-tool/                 # MCP 工具定义与共享 handler
│   │   ├── types.ts
│   │   ├── inbox-store.ts
│   │   └── tools/                # 27 个工具；媒体工具使用 Worker-safe wrapper
│   ├── cli/                      # remote-only woa CLI（OAuth/REST/MCP 配置）
│   ├── storage/
│   │   ├── types.ts              # StorageManager interface
│   │   └── d1-storage-manager.ts # Cloudflare D1 + enc: 加密兼容
│   ├── utils/
│   │   ├── logger.ts             # 日志（含敏感字段脱敏）
│   │   └── validation.ts         # Zod schema、HTML 消毒、媒体校验
│   ├── wechat/
│   │   ├── api-client.ts         # 微信 API 方法；必须注入 HTTP executor
│   │   ├── http-executor.ts      # access_token 注入与安全错误日志
│   │   ├── proxy.ts              # HTTPS relay proxy helper
│   │   └── workers-http-executor.ts # Workers/fetch 实现
│   └── worker/
│       ├── index.ts              # Workers Remote MCP、OAuth、TokenOwner DO、Webhook 路由
│       ├── media-tools.ts        # MCP 公开 fileUrl/R2；fileData 仅 handler 级兼容
│       ├── media-upload.ts       # OAuth 保护的二进制上传与租户化 R2 暂存
│       ├── inbox-store.ts        # inbound_messages D1 查询
│       └── wechat-webhook.ts     # 微信回调验签、解密、入库
├── test-tools.js                 # 构建后验证脚本
├── wrangler.jsonc                # Workers/D1/R2/DO/KV/secrets bindings
└── package.json
```

已删除的本地桌面端路径不应恢复：`src/cli.ts`、`src/mcp-server/`、`src/auth/auth-manager.ts`、`src/storage/storage-manager.ts`、`src/wechat/node-http-executor.ts`、旧 Node 媒体工具。


## 构建与开发命令

### 核心脚本

```bash
# Workers 本地开发
npm run dev
npm run worker:dev

# TypeScript 编译（开发配置，输出到 dist/）
npm run build

# 生产构建（更严格的 tsconfig.prod.json）
npm run build:prod

# 完整构建（清理 + 类型检查 + 生产编译 + 验证）
npm run build:full      # 等价于 ./scripts/build.sh

# 仅类型检查，不输出文件
npm run check

# 代码检查
npm run lint

# 测试（生产构建后验证 27 个工具、关键 fixtures 与 Web SSR smoke）
npm test

# Workers 验证/部署
npx wrangler deploy --dry-run
npm run worker:deploy
npm run d1:migrate:local

# 预览 npm 包内容
npm run pack:dry
```

### HTTP MCP 入口

- 生产/远程 MCP：`https://<your-worker-domain>/mcp`（Streamable HTTP + OAuth）
- 微信回调：`https://<your-worker-domain>/wx/callback`
- 本地桌面端 `wechat-mcp mcp ...` / `stdio` transport 已移除；客户端应使用原生 Streamable HTTP。remote-only `woa` CLI 只负责 OAuth、REST 操作与生成远程 `/mcp` 配置。
- 微信 API 出站固定 IP 使用 `WECHAT_PROXY_URL` HTTPS relay；HTTP CONNECT forward proxy 已不支持。


## 代码风格与规范

### 模块系统

- **必须使用 ES Modules**。`package.json` 中设置了 `"type": "module"`。
- **所有 TypeScript 导入必须带 `.js` 扩展名**，即使是导入 `.ts` 文件。例如：
  ```typescript
  import { logger } from '../../utils/logger.js';
  import { McpTool } from '../types.js';
  ```

### 路径别名

- `@/*` 映射到 `./src/*`，在 `tsconfig.json` 和 `vite.config.ts` 中配置。
- 但在 Node.js 后端运行环境（`tsc` 编译后的代码）中，路径别名不会被自动解析。因此 **后端源码中不建议使用 `@/` 别名**，而应使用相对路径。当前项目中后端代码均使用相对路径。

### TypeScript 配置

- **开发配置** (`tsconfig.json`): `strict: false`，允许隐式 any，方便快速开发。
- **生产配置** (`tsconfig.prod.json`): 继承基础配置，排除测试文件和配置文件，关闭 source map 和注释。
- ESLint 规则中显式关闭了 `@typescript-eslint/no-explicit-any`。

### 命名规范

- 文件：kebab-case（如 `draft-tool.ts`, `api-client.ts`）
- 类：PascalCase（如 `WechatApiClient`, `D1StorageManager`）
- 接口：PascalCase（如 `WechatToolResult`, `AccessTokenInfo`）
- 函数/变量：camelCase（如 `handleDraftOperations`, `authManager`）
- 常量：UPPER_SNAKE_CASE（如 `SENSITIVE_FIELDS`）
- 工具名：snake_case（如 `wechat_draft`, `wechat_media_upload`）

### 注释风格

- 使用中文注释描述业务逻辑。
- JSDoc/TSDoc 风格用于接口和复杂函数说明。

---

## 架构与数据流

### 启动流程

1. Cloudflare Workers 读取 D1/R2/DO/KV bindings、OAuth credentials、微信公众号 secrets 和可选 relay proxy 配置。
2. `WechatMcpAgent.init()` 创建 `D1StorageManager`、`D1InboxStore`、`WorkersAuthManager`、`TokenOwner`、`WechatApiClient`。
3. `WechatApiClient` 必须注入 `AccessTokenHttpExecutor(WorkersHttpExecutor)`；不要恢复默认 Node executor。
4. `createWorkerMediaTools()` 注册 HTTP-safe 媒体工具：MCP schema 仅公开 `fileUrl` / `r2Key`；本地文件通过 `woa media upload <path>` 调用受保护的 REST 接口暂存到 R2，`fileData` 仅保留 handler 级兼容。
5. `registerWorkerMcpTool()` 将 27 个工具注册到 Workers `/mcp` Streamable HTTP MCP server。

### 工具调用数据流

```
AI 客户端 → Workers /mcp (OAuth + McpAgent) → tool handler
                                                ↓
                                        WechatApiClient
                                                ↓
                                  WorkersHttpExecutor / relay
                                                ↓
                                      微信公众号 API
```

### 入站消息数据流

```
微信服务器 → /wx/callback → 验签/AES 解密 → D1 inbound_messages → 外部 AI 调用 wechat_inbox 拉取处理
```

### 核心组件关系

- **Workers Remote MCP** (`src/worker/index.ts`): 使用 Agents SDK `McpAgent.serve('/mcp')` 暴露 OAuth 保护的 Streamable HTTP MCP；`TokenOwner` Durable Object 负责全局唯一 token 刷新；`/wx/callback` 只做验签/解密/写入 D1/ack。
- **`WechatApiClient`** (`src/wechat/api-client.ts`): 共享微信公众号 API 方法；HTTP-only 运行时必须注入 `HttpExecutor`；`AccessTokenHttpExecutor` 自动注入 `access_token` 并安全记录错误。
- **`WorkersHttpExecutor`** (`src/wechat/workers-http-executor.ts`): 使用 Workers `fetch` / Web FormData / Uint8Array；支持 `WECHAT_PROXY_URL` HTTPS relay。
- **`D1StorageManager`** (`src/storage/d1-storage-manager.ts`): D1 配置、token、素材等 CRUD，敏感字段以 `enc:` 加密存储。
- **`createWorkerMediaTools`** (`src/worker/media-tools.ts`): Worker-safe 媒体上传工具；不读取本地文件系统。


## 工具开发规范

### 添加新工具的标准步骤

1. 在 `src/mcp-tool/tools/` 下新建文件（如 `new-tool.ts`）
2. 导入必要依赖：
   ```typescript
   import { z } from 'zod';
   import { McpTool, WechatApiClient, WechatToolResult } from '../types.js';
   import { logger } from '../../utils/logger.js';
   ```
3. 定义 Zod schema（尽量复用 `src/utils/validation.ts` 中的已有 schema）
4. 实现 `McpTool` 接口，导出一个对象：
   ```typescript
   export const newMcpTool: McpTool = {
     name: 'wechat_new_feature',
     description: '工具描述',
     inputSchema: {
       action: z.enum(['list', 'get']).describe('操作类型'),
       id: z.string().optional().describe('ID'),
     },
     handler: async (args: unknown, apiClient: WechatApiClient): Promise<WechatToolResult> => {
       const { action, id } = args as any;
       // ... 调用 apiClient 方法
       return {
         content: [{ type: 'text', text: '操作结果...' }]
       };
     }
   };
   ```
5. 在 `src/mcp-tool/tools/index.ts` 的 `mcpTools` 数组中加入新工具

### 返回值格式

所有工具 handler 必须返回 `WechatToolResult`：

```typescript
{
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    uri?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}
```

错误处理：Workers 注册层 `registerWorkerMcpTool()` 会捕获异常并包装为错误文本。handler 内部也可自行捕获并返回 `isError: true` 的结果。

---

## 测试策略

### 当前状态

- **无单元测试文件**。项目目前没有 `.test.ts` 或 `.spec.ts` 文件。
- `npm test` 的实际行为：`npm run build:prod && node test-tools.js`
- `test-tools.js` 导入编译后的产物，检查 `mcpTools` 数组长度是否为 27，并验证 Workers HTTP executor、D1 storage、OAuth/CLI、quota/billing、webhook/inbox fixtures，且确认本地 stdio MCP server 构建产物不存在；`scripts/web-render-smoke.mjs` 验证关键 Web 路由 SSR。

### 测试建议

- 提交前至少运行 `npm run check` 和 `npm run build:prod` 确保无类型错误。
- 如需添加新工具，同步更新 `test-tools.js` 中的期望数量（或改为动态验证）。

---

## 安全规范

### 环境变量

| 变量 | 说明 | 建议 |
|------|------|------|
| `NODE_ENV` | 运行模式（development/production） | 生产环境设为 `production` |
| `DEBUG` | 开启 debug 日志（`true` 或 `1`） | 生产环境避免开启 |
| `CORS_ORIGIN` | 本地 REST/API 脚手架跨域白名单，逗号分隔 | **生产环境必须设置，严禁使用 `*`** |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 公众号凭证 | Workers secret binding |
| `WECHAT_MCP_SECRET_KEY` | D1 AES-256 加密密钥 | **强烈建议生产环境设置；Workers 使用 Secrets Store/secret binding** |
| `WECHAT_WEBHOOK_TOKEN` | 微信服务器配置 Token | Workers `/wx/callback` 验签使用，必须通过 secret binding |
| `WECHAT_ENCODING_AES_KEY` | 微信安全模式 EncodingAESKey | Workers 加密回调解密使用，必须通过 secret binding |
| `WECHAT_PROXY_URL` | 微信 API 出站 HTTPS relay 代理地址 | 可选；用于微信公众号 IP 白名单/固定出口；Workers 使用 Secrets Store/secret binding |
| `WECHAT_PROXY_TOKEN` | relay 代理鉴权 token | 可选；以 `x-wechat-proxy-token` header 发送，避免提交明文 |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | Remote MCP OAuth 凭证 | Workers `/mcp` OAuth 使用，必须通过 secret binding |

### 安全机制

1. **加密存储**: 设置 `WECHAT_MCP_SECRET_KEY` 后，`app_secret`、`token`、`encoding_aes_key`、`access_token` 等敏感字段将以 AES-256 加密形式存储，数据库中值以 `enc:` 前缀标识。
2. **日志脱敏**: `logger.ts` 自动识别敏感字段名（`appSecret`、`access_token`、`token` 等），对值进行截断处理（长字符串保留前8位和后4位，短字符串替换为 `***`）。
3. **输入消毒**: `validation.ts` 中的 `sanitizeHtmlContent()` 移除 HTML 中的 `<script>`、`<iframe>`、事件处理器等危险内容。
4. **文件类型白名单**: 媒体上传校验 `ALLOWED_MEDIA_TYPES`，拒绝非法文件类型。
5. **Token 自动刷新**: 到期前自动刷新，使用 promise 锁避免并发重复请求。
6. **CORS 白名单**: 本地 REST/API 脚手架读取 `CORS_ORIGIN` 环境变量作为允许来源列表。
7. **微信 API 出站代理**: `WECHAT_PROXY_URL` 会将所有 `api.weixin.qq.com` token/API/上传请求发往 HTTPS relay，并通过 `x-wechat-proxy-target-url` header 传递目标 URL（默认不放 query，避免 access_token/AppSecret 进入代理访问日志）；relay 服务必须部署在已加入公众号白名单的固定出口 IP 上并原样转发请求/响应。relay 必须校验 `x-wechat-proxy-token`（如启用）、限制只转发 `https://api.weixin.qq.com/*`，并在 access log 中禁用或脱敏 `x-wechat-proxy-target-url` / `x-wechat-proxy-token`。HTTP CONNECT forward proxy 已移除；Workers 仅支持 relay 模式。
8. **Remote MCP OAuth**: Workers `/mcp` 必须经 OAuth 访问；旧 `/api/wechat/tools/*` 在 Workers 中只返回迁移说明，不执行工具。

### 敏感操作禁忌

- **不要将 AppSecret、Token 等凭证提交到代码仓库。**
- **不要在生产环境开启 `DEBUG` 日志。**
- **不要将 `CORS_ORIGIN` 设为 `*`。**

---

## 部署说明

### Cloudflare Workers Remote MCP 部署（唯一 MCP 运行时）

- `src/worker/index.ts` 是 Workers 入口，暴露：
  - `/mcp`：OAuth 保护的 MCP Streamable HTTP endpoint
  - `/wx/callback`：微信公众号回调，验签/解密/写入 `inbound_messages` 后快速 ack
  - `/health` / `/api/health`：健康检查
- `wrangler.jsonc` 配置 Durable Objects（`WECHAT_MCP_AGENT`, `TOKEN_OWNER`）、D1（`DB`）、R2（`MEDIA`）、KV（`OAUTH_KV`）和 Secrets Store bindings。
- 不要在 `wrangler.jsonc` 或仓库文件中提交真实密钥；使用 Cloudflare Secrets Store / `wrangler secret`。
- 本地桌面端 stdio MCP transport 与 MCP-over-SSE (`/sse` / `/messages`) 已移除；远程客户端应迁移到 OAuth 后的 Workers `/mcp` Streamable HTTP `tools/list` / `tools/call`，或使用 remote-only `woa` CLI。

### Vercel 部署

- `api/index.ts` 是 Vercel Serverless 入口，使用 `@vercel/node` 运行时。
- `vercel.json` 配置：
  - `/api/*` 路由指向 `api/index.ts`
  - 其他所有路由回退到 `index.html`（SPA 行为）

### 本地 API 服务器（非 MCP 传输）

```bash
# 启动 Express 后端（端口 3001）
npx nodemon  # 或 tsx api/server.ts

# 前端开发服务器（端口 5173，Vite）
npx vite
```

Vite 开发服务器配置了代理：`/api` → `http://localhost:3001`。

---

## 关键文件速查

| 文件 | 用途 |
|------|------|
| `src/index.ts` | HTTP-only 库导出入口 |
| `src/worker/index.ts` | Workers `/mcp`、OAuth、TokenOwner DO、Webhook 路由 |
| `src/worker/media-tools.ts` | Worker-safe 微信媒体上传 wrapper（MCP 公开 fileUrl/R2） |
| `src/worker/media-upload.ts` | OAuth 保护的本地文件二进制暂存与 R2 key 生成 |
| `src/worker/wechat-webhook.ts` | 微信回调验签、AES 解密、入库 |
| `src/worker/inbox-store.ts` | `inbound_messages` D1 查询 |
| `src/mcp-tool/tools/index.ts` | 27 个工具的导出与注册列表 |
| `src/mcp-tool/tools/inbox-tool.ts` | 入站消息 MCP 工具 |
| `src/wechat/api-client.ts` | 微信 HTTP API 封装（endpoint/字段 contract 以官方核验文档为准） |
| `src/wechat/workers-http-executor.ts` | Workers fetch/Web FormData HTTP executor |
| `src/storage/d1-storage-manager.ts` | D1 数据库 + 可选加密 |
| `src/utils/validation.ts` | Zod schema、HTML 消毒、媒体校验 |
| `src/utils/logger.ts` | 带脱敏的日志工具 |
| `test-tools.js` | 构建后验证脚本 |
| `scripts/build.sh` | 完整构建流程 |


## 相关文档

- `WECHAT_OFFICIAL_API_CONTRACT.md` — 微信官方 API contract 本地核验记录（endpoint、字段、签名、偏差）
- `README.md` — 中文用户指南（安装、配置、AI 应用集成）
- `CLAUDE.md` — 面向 Claude Code 的开发者指南（架构、工具模式、安全）
- `FEATURES_OVERVIEW.md` — 功能总览与对比
- `CHANGELOG.md` — 版本历史

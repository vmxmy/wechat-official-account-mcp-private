# AGENTS.md

> 本文件为 AI 编码助手提供项目背景、开发规范和操作指南。
> 项目的主要人类文档为中文，因此本文件以中文撰写。

---

## 项目概述

本项目是一个 **微信公众号 MCP (Model Context Protocol) 服务器**，为 Claude Desktop、Cursor、Trae AI 等 AI 应用提供微信公众号常用运营 API 工具集。

- **名称**: `wechat-official-account-mcp`
- **版本**: `v2.0.0`
- **作者**: xwang152-jack <xwang152@163.com>
- **许可证**: MIT
- **仓库**: https://github.com/xwang152-jack/wechat-official-account-mcp

**当前能力**: 15 个 MCP 工具，覆盖认证、素材、草稿、发布、用户、标签、菜单、模板消息、客服消息、数据统计、自动回复、群发、订阅通知等常用能力。API endpoint、字段名、签名算法和限制以 [WECHAT_OFFICIAL_API_CONTRACT.md](./WECHAT_OFFICIAL_API_CONTRACT.md) 及微信官方开发文档为唯一真源；不要使用“95%/100% 覆盖”等未经逐项核验的表述。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | Node.js 18+ | 最低版本要求 |
| 语言 | TypeScript 5.8 | 严格模式关闭（开发配置） |
| 模块系统 | ES Modules (`"type": "module"`) | 所有导入必须使用 `.js` 扩展名 |
| 协议 | MCP SDK v1.0 | Model Context Protocol |
| 前端框架 | React 19 + React Router 7 | 最小化脚手架，当前几乎无实际页面；React 19 用于满足 Cloudflare Agents SDK peer 依赖 |
| 样式 | Tailwind CSS 3.4 + PostCSS | 工具类优先 CSS |
| 构建工具 | Vite 6 | 前端开发服务器与打包 |
| 后端编译 | `tsc` | TypeScript 直接编译到 `dist/`，非 Vite |
| CLI 框架 | Commander.js 12 | 命令行参数解析 |
| HTTP 客户端 | Axios 1.6 | 微信 API 调用，含自动 token 注入 |
| HTTP 服务器 | Express 4.21 | SSE 传输模式与 API 路由 |
| 数据库 | SQLite3 | 本地持久化存储 |
| 参数校验 | Zod 4.4 | 工具输入 schema 定义与校验；MCP SDK 1.29 / Agents SDK 采用 Zod 4 peer |
| 加密 | crypto-js | AES-256 字段级加密（可选） |
| 文件上传 | Multer + form-data | 媒体素材上传 |
| 开发执行 | tsx | 开发时直接运行 TypeScript |
| 代码检查 | ESLint 9 + typescript-eslint | 含 React Hooks 规则 |

---

## 官方 API Contract 真源

- 微信公众号 API 的 endpoint、请求字段、返回字段、签名算法、错误码和频率/权限限制，以微信官方开发文档为唯一真源。
- 本仓库维护本地核验记录：`WECHAT_OFFICIAL_API_CONTRACT.md`。新增或修改任何微信 API 调用前，先查该文件并重新打开对应官方文档。
- 已知需修正：`wechat_subscribe_msg` 当前 endpoint/字段与官方订阅通知 contract 不一致；`wechat_permanent_media` 的 `news` 分支与 schema 不一致；`wechat_customer_service.get_records` 缺少已核验 endpoint。
- Cloudflare 迁移的 OpenSpec 参考：`openspec/changes/migrate-to-cloudflare-workers/wechat-official-api-contract.md`。

---

## 项目结构

```
wechat-official-account-mcp/
├── api/                          # Express 后端（SSE 传输 + API 路由）
│   ├── app.ts                    # Express 应用配置（CORS、路由、中间件）
│   ├── index.ts                  # Vercel Serverless 入口
│   ├── server.ts                 # 本地开发服务器（端口 3001）
│   └── routes/
│       └── auth.ts               # 认证路由示例（TODO）
├── data/
│   └── wechat-mcp.db             # SQLite 数据库（gitignore，首次运行时自动创建）
├── public/
│   └── favicon.svg               # 静态资源
├── scripts/
│   └── build.sh                  # 完整构建脚本（含校验）
├── src/                          # 核心源码
│   ├── cli.ts                    # CLI 入口（Commander.js）
│   ├── index.ts                  # 库模式导出入口
│   ├── main.tsx / App.tsx        # React 前端入口（最小化）
│   ├── auth/
│   │   └── auth-manager.ts       # 微信凭证与 Access Token 生命周期管理
│   ├── mcp-server/               # MCP 服务器层
│   │   ├── shared/
│   │   │   ├── init.ts           # 服务器初始化逻辑
│   │   │   └── types.ts          # McpServerOptions 等类型
│   │   └── transport/
│   │       ├── stdio.ts          # stdio 传输（Claude Desktop 默认）
│   │       └── sse.ts            # SSE 传输（基于 Express）
│   ├── mcp-tool/                 # MCP 工具层
│   │   ├── index.ts              # WechatMcpTool 类（注册与执行）
│   │   ├── types.ts              # 核心类型定义
│   │   └── tools/                # 15 个具体工具实现
│   │       ├── index.ts          # 工具导出与注册列表
│   │       ├── auth-tool.ts
│   │       ├── media-upload-tool.ts
│   │       ├── upload-img-tool.ts
│   │       ├── permanent-media-tool.ts
│   │       ├── draft-tool.ts
│   │       ├── publish-tool.ts
│   │       ├── user-tool.ts
│   │       ├── tag-tool.ts
│   │       ├── menu-tool.ts
│   │       ├── template-msg-tool.ts
│   │       ├── customer-service-tool.ts
│   │       ├── statistics-tool.ts
│   │       ├── auto-reply-tool.ts
│   │       ├── mass-send-tool.ts
│   │       └── subscribe-msg-tool.ts
│   ├── storage/
│   │   └── storage-manager.ts    # SQLite 持久化 + 可选 AES 加密
│   ├── utils/
│   │   ├── logger.ts             # 日志（含敏感字段脱敏）
│   │   ├── validation.ts         # Zod schema 与输入消毒
│   │   └── db-init.ts            # 数据库初始化
│   └── wechat/
│       └── api-client.ts         # Axios HTTP 客户端（多项微信公众号 API 封装；contract 以 WECHAT_OFFICIAL_API_CONTRACT.md 为准）
├── eslint.config.js              # ESLint 配置（TS + React Hooks）
├── nodemon.json                  # API 开发热重载配置
├── package.json                  # 依赖与脚本
├── postcss.config.js             # PostCSS（Tailwind + Autoprefixer）
├── tailwind.config.js            # Tailwind CSS 配置
├── test-tools.js                 # 构建后验证脚本（检查 15 个工具注册）
├── tsconfig.json                 # 开发配置（宽松）
├── tsconfig.prod.json            # 生产配置（更严格，排除测试/配置）
├── vercel.json                   # Vercel 路由重写（API + SPA fallback）
└── vite.config.ts                # Vite 配置（React、代理、路径别名）
```

---

## 构建与开发命令

### 核心脚本

```bash
# 开发模式直接运行 CLI（使用 tsx，无需编译）
npm run dev -- mcp -a <app_id> -s <app_secret>

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

# 测试（生产构建后运行 test-tools.js 验证 15 个工具）
npm test

# 运行编译后的 CLI
npm start -- mcp -a <app_id> -s <app_secret>
# 或直接
node dist/src/cli.js mcp -a <app_id> -s <app_secret>

# 预览 npm 包内容
npm run pack:dry

# 本地包测试
npm run pack:test
```

### CLI 参数

```bash
npx wechat-mcp mcp -a <appId> -s <appSecret> [-m <stdio|sse>] [-p <port>]
```

- `-a, --app-id`: 微信公众号 AppID（必需）
- `-s, --app-secret`: 微信公众号 AppSecret（必需）
- `-m, --mode`: 传输模式，`stdio`（默认，用于 Claude Desktop）或 `sse`（用于 Web/远程）
- `-p, --port`: SSE 模式端口（默认 3000）

---

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
- 类：PascalCase（如 `WechatApiClient`, `AuthManager`）
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

1. `src/cli.ts` 解析命令行参数 → `McpServerOptions`
2. `initMcpServerWithTransport(options)` 根据 mode 分发到 stdio 或 SSE
3. `initWechatMcpServer()` 创建三件套：
   - `McpServer` (来自 `@modelcontextprotocol/sdk`)
   - `AuthManager`（管理凭证与 token）
   - `WechatMcpTool`（工具注册与执行）
4. `wechatTool.registerTools(mcpServer)` 将所有工具注册到 MCP 服务器

### 工具调用数据流

```
AI 客户端 → MCP Server → WechatMcpTool → 具体 tool handler
                                            ↓
                                    WechatApiClient
                                            ↓
                                    微信公众号 API
```

### 核心组件关系

- **`AuthManager`** (`src/auth/auth-manager.ts`): 管理 AppID/AppSecret 配置，自动刷新 Access Token（到期前 5 分钟刷新），使用 `refreshPromise` 锁防止并发刷新。
- **`WechatApiClient`** (`src/wechat/api-client.ts`): Axios 实例，请求拦截器自动注入 `access_token`，响应拦截器仅记录状态码/消息（不记录完整响应体）。具体 endpoint 和字段 contract 以 `WECHAT_OFFICIAL_API_CONTRACT.md` 及微信官方文档为准。
- **`WechatMcpTool`** (`src/mcp-tool/index.ts`): 工具注册中心，将每个 tool handler 包装为统一错误处理格式。
- **`StorageManager`** (`src/storage/storage-manager.ts`): SQLite 操作，支持通过 `WECHAT_MCP_SECRET_KEY` 启用 AES-256 字段加密。加密值在数据库中以 `enc:` 前缀标识。

---

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

错误处理：由 `WechatMcpTool.registerTools()` 统一捕获异常并包装为错误文本。handler 内部也可自行捕获并返回 `isError: true` 的结果。

---

## 测试策略

### 当前状态

- **无单元测试文件**。项目目前没有 `.test.ts` 或 `.spec.ts` 文件。
- `npm test` 的实际行为：`npm run build:prod && node test-tools.js`
- `test-tools.js` 是一个简单的验证脚本，导入编译后的 `dist/src/mcp-tool/tools/index.js`，检查 `mcpTools` 数组长度是否为 15，并打印每个已注册工具的名称。

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
| `CORS_ORIGIN` | SSE 模式的跨域白名单，逗号分隔 | **生产环境必须设置，严禁使用 `*`** |
| `WECHAT_MCP_SECRET_KEY` | AES-256 加密密钥 | **强烈建议生产环境设置** |
| `DB_PATH` | SQLite 数据库路径 | 默认 `./data/wechat-mcp.db` |

### 安全机制

1. **加密存储**: 设置 `WECHAT_MCP_SECRET_KEY` 后，`app_secret`、`token`、`encoding_aes_key`、`access_token` 等敏感字段将以 AES-256 加密形式存储，数据库中值以 `enc:` 前缀标识。
2. **日志脱敏**: `logger.ts` 自动识别敏感字段名（`appSecret`、`access_token`、`token` 等），对值进行截断处理（长字符串保留前8位和后4位，短字符串替换为 `***`）。
3. **输入消毒**: `validation.ts` 中的 `sanitizeHtmlContent()` 移除 HTML 中的 `<script>`、`<iframe>`、事件处理器等危险内容。
4. **文件类型白名单**: 媒体上传校验 `ALLOWED_MEDIA_TYPES`，拒绝非法文件类型。
5. **Token 自动刷新**: 到期前自动刷新，使用 promise 锁避免并发重复请求。
6. **CORS 白名单**: SSE 模式读取 `CORS_ORIGIN` 环境变量作为允许来源列表。

### 敏感操作禁忌

- **不要将 AppSecret、Token 等凭证提交到代码仓库。**
- **不要在生产环境开启 `DEBUG` 日志。**
- **不要将 `CORS_ORIGIN` 设为 `*`。**

---

## 部署说明

### 作为 npm 包使用（推荐）

```bash
npx wechat-official-account-mcp mcp -a <app_id> -s <app_secret>
```

### 全局安装

```bash
npm install -g wechat-official-account-mcp
wechat-mcp mcp -a <app_id> -s <app_secret>
```

### Vercel 部署

- `api/index.ts` 是 Vercel Serverless 入口，使用 `@vercel/node` 运行时。
- `vercel.json` 配置：
  - `/api/*` 路由指向 `api/index.ts`
  - 其他所有路由回退到 `index.html`（SPA 行为）

### 本地服务器（SSE 模式）

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
| `src/cli.ts` | CLI 入口，解析参数，启动 MCP 服务器 |
| `src/index.ts` | 库导出（CLI、MCP Server、MCP Tools、logger） |
| `src/mcp-server/shared/init.ts` | 服务器初始化，组装 AuthManager + WechatMcpTool |
| `src/mcp-tool/index.ts` | 工具注册中心，包装错误处理 |
| `src/mcp-tool/tools/index.ts` | 15 个工具的导出与注册列表 |
| `src/auth/auth-manager.ts` | Access Token 生命周期管理 |
| `src/wechat/api-client.ts` | 微信 HTTP API 封装（endpoint/字段 contract 以官方核验文档为准） |
| `src/storage/storage-manager.ts` | SQLite 数据库 + 可选加密 |
| `src/utils/validation.ts` | Zod schema、HTML 消毒、媒体校验 |
| `src/utils/logger.ts` | 带脱敏的日志工具 |
| `test-tools.js` | 构建后验证脚本 |
| `scripts/build.sh` | 完整构建流程 |

---

## 相关文档

- `WECHAT_OFFICIAL_API_CONTRACT.md` — 微信官方 API contract 本地核验记录（endpoint、字段、签名、偏差）
- `README.md` — 中文用户指南（安装、配置、AI 应用集成）
- `CLAUDE.md` — 面向 Claude Code 的开发者指南（架构、工具模式、安全）
- `FEATURES_OVERVIEW.md` — v2.0.0 功能总览与对比
- `CHANGELOG.md` — 版本历史（v1.0.3 → v1.1.0 → v2.0.0）

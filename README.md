# 微信公众号 MCP 服务

一个为 AI 应用提供微信公众号 API 集成的 MCP (Model Context Protocol) 服务项目。

**作者**: xwang152-jack <xwang152@163.com>
**更新日期**: 2026年07月02日

## 🚀 项目概述

本项目基于 MCP 协议，为 AI 应用（如 Claude Desktop、Cursor、Trae AI 等）提供微信公众号 API 工具集。通过标准化的工具接口，AI 应用可以管理微信公众号的用户、标签、菜单、素材、草稿、发布、消息、数据统计、二维码、评论、黑名单、入站消息收件箱等常用运营能力。

**当前版本**: `v2.2.0` （查看 [CHANGELOG](./CHANGELOG.md) | [v1.1.0 Release Notes](./RELEASE_NOTES_v1.1.0.md)）

**v2.2.0 + HTTP-only 更新**: 新增二维码、短链接、评论管理、黑名单、客服账号、账号管理等工具，并保留入站消息收件箱；当前共 22 个 MCP 工具。运行时已切换为 Cloudflare Workers Remote MCP（OAuth 保护的 `/mcp`、D1/R2/Durable Object、微信公众号 `/wx/callback/{accountId}`），本地桌面端 stdio/CLI 与 MCP-over-SSE 已移除。API contract 以 [微信官方 API Contract 核验](./WECHAT_OFFICIAL_API_CONTRACT.md) 和微信官方开发文档为唯一真源；当前工具覆盖情况和已知偏差以该文档为准。

## 📖 文档导航

- **[功能总览 (FEATURES_OVERVIEW.md)](./FEATURES_OVERVIEW.md)** - v2.0.0 工具介绍、对比表格和使用场景
- **[微信官方 API Contract 核验 (WECHAT_OFFICIAL_API_CONTRACT.md)](./WECHAT_OFFICIAL_API_CONTRACT.md)** - 已核验的官方接口、项目覆盖情况和已知偏差
- **[更新日志 (CHANGELOG.md)](./CHANGELOG.md)** - 版本历史和详细更新内容
- **[开发者指南 (CLAUDE.md)](./CLAUDE.md)** - 架构说明、开发规范、常见模式

### 官方文档真源原则

- 与微信公众号 API 相关的 endpoint、字段名、签名算法、错误码和限制，以 [微信官方文档](https://developers.weixin.qq.com/doc/) 为唯一真源。
- 本仓库已整理一份本地核验记录：[WECHAT_OFFICIAL_API_CONTRACT.md](./WECHAT_OFFICIAL_API_CONTRACT.md)。实现或修改工具前先查该文档，并重新打开官方页面确认最新 contract。
- 不以 README、功能总览或代码里的历史实现作为 API contract 真源。

## ✨ 核心功能

- **🔐 认证管理**: 安全管理微信公众号 AppID、AppSecret 和 Access Token
- **📁 素材管理**: 上传、获取、管理临时和永久素材
- **📝 草稿管理**: 创建、编辑、管理图文草稿
- **📢 发布管理**: 发布草稿到微信公众号
- **📥 入站消息收件箱**: 接收并查询微信公众号回调消息/事件，外部 AI Agent 可拉取待处理消息
- **💾 云端存储**: 使用 Cloudflare D1/R2/Durable Objects 持久化配置、素材和会话状态
- **☁️ Remote MCP**: Cloudflare Workers + Agents SDK + OAuth + D1/R2/DO，适合远程 MCP 客户端
- **🔧 MCP 集成**: 完全兼容 MCP 协议标准
- **🛡️ 安全增强（v1.1.0）**: 支持敏感字段加密存储与日志脱敏，跨域来源白名单配置

## 🛠️ 技术栈

- **运行时**: Node.js 18+
- **语言**: TypeScript
- **协议**: MCP (Model Context Protocol)
- **数据库**: Cloudflare D1、R2、Durable Objects
- **HTTP 客户端**: Workers `fetch`
- **远程运行时**: Cloudflare Workers、Agents SDK `McpAgent`、Workers OAuth Provider
- **参数验证**: Zod
- **构建工具**: Vite

## 📦 快速开始

本项目现在是 **HTTP-only Remote MCP**：

- MCP 入口：Cloudflare Workers `/mcp`（Streamable HTTP + OAuth）
- 微信回调：`/wx/callback/{accountId}`（推荐，accountId 为管理面生成的不透明账号 ID）；旧 `/wx/callback` 仅在安全的单账号兼容模式下处理，否则返回迁移提示
- 本地桌面端 stdio CLI 与 MCP-over-SSE 均已移除

### Cloudflare Workers Remote MCP（推荐）

```bash
# 安装依赖
npm install

# 本地 Workers 开发
npm run dev
# 或
npm run worker:dev

# 本地 D1 迁移
npm run d1:migrate:local

# 部署前 dry-run
npx wrangler deploy --dry-run

# 部署
npm run worker:deploy
```

部署后使用：

- MCP endpoint：`https://<your-worker-domain>/mcp`
- 微信回调 endpoint：`https://<your-worker-domain>/wx/callback/{accountId}`
- 单账号兼容 endpoint：`https://<your-worker-domain>/wx/callback`（多账号或无法安全推断账号时会拒绝并提示迁移）
- 旧 REST 工具调用：`/api/wechat/tools/*` 在 Workers 中已移除，只返回迁移说明，不会执行工具

`wrangler.jsonc` 只引用 Secrets Store / Worker Secret 绑定，不应提交真实密钥。生产部署前至少设置：

| Secret binding | 用途 |
|---|---|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 公众号凭证 |
| `WECHAT_MCP_SECRET_KEY` | D1 敏感字段 AES 加密密钥 |
| `WECHAT_WEBHOOK_TOKEN` | 单账号兼容模式下的微信服务器配置 Token；多账号应使用账号配置中的 webhook token |
| `WECHAT_ENCODING_AES_KEY` | 微信安全模式 EncodingAESKey |
| `WECHAT_DEFAULT_WEBHOOK_ACCOUNT_ID` | 可选：旧 `/wx/callback` 的显式默认账号 ID；未配置且存在多个账号时旧路由会拒绝处理 |
| `WECHAT_PROXY_URL` | 可选：微信 API 出站 HTTPS relay 代理地址（固定出口 IP） |
| `WECHAT_PROXY_TOKEN` | 可选：relay 代理鉴权 token |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | Remote MCP OAuth 客户端凭证 |
| `STRIPE_SECRET_KEY` | 可选：创建 Stripe Checkout Session 的 secret key |
| `STRIPE_WEBHOOK_SECRET` | 可选：校验 Stripe webhook `Stripe-Signature` |
| `STRIPE_PLUS_PRICE_ID` / `STRIPE_PRO_PRICE_ID` | 可选：Plus/Pro 订阅价格 ID |
| `STRIPE_BILLING_SUCCESS_URL` / `STRIPE_BILLING_CANCEL_URL` | 可选：Checkout 默认成功/取消跳转 URL |

Stripe Checkout 采用 fail-closed 策略：只有 secret key、webhook secret、Plus/Pro price ID、默认成功/取消 URL 全部配置后，受 OAuth 保护的付费 checkout 能力才会启用。

> 生产注意：微信公众号 API 通常要求在公众号后台配置服务器 IP 白名单。Cloudflare Workers 默认出口 IP 不固定，正式切流前请配置固定出口代理。Workers 不支持传统 HTTP CONNECT forward proxy，本项目支持 `WECHAT_PROXY_URL` HTTPS relay：所有发往 `api.weixin.qq.com` 的 token/API/上传请求会改发到 relay，并通过 `x-wechat-proxy-target-url` header 传递目标 URL（默认不放 query，避免 access_token/AppSecret 进入代理访问日志）；relay 服务需在白名单 IP 机器上按原 method/body/headers 转发到该 target，并原样返回微信响应。
> relay 运维要求：relay 必须校验 `x-wechat-proxy-token`（如启用），限制只转发到 `https://api.weixin.qq.com/*`，并在 access log 中禁用或脱敏 `x-wechat-proxy-target-url` 与 `x-wechat-proxy-token` header，避免目标 URL 中的 `access_token` 或 AppSecret 落盘。

## 🔧 MCP 工具列表

### 1. 认证工具 (`wechat_auth`)

管理微信公众号认证配置和 Access Token。

**支持操作**:
- `configure`: 配置 AppID 和 AppSecret
- `get_token`: 获取当前 Access Token
- `refresh_token`: 刷新 Access Token
- `get_config`: 查看当前配置

### 2. 素材上传工具 (`wechat_media_upload`)

上传和管理微信公众号临时素材。

**支持操作**:
- `upload`: 上传素材（图片、语音、视频、缩略图）
- `get`: 获取素材信息
- `list`: 暂不支持（临时素材有效期 3 天，建议使用永久素材功能）

**支持格式**:
- 图片：JPG、PNG（大小不超过 10MB）
- 语音：MP3、WMA、WAV、AMR（大小不超过 10MB，时长不超过 60s）
- 视频：MP4（大小不超过 10MB）
- 缩略图：JPG（大小不超过 64KB）

### 3. 图文消息图片上传工具 (`wechat_upload_img`)

上传图文消息内所需的图片，不占用素材库限制。

**支持操作**:
- `upload`: 上传图片（支持文件路径或base64数据）

**支持格式**:
- 图片：JPG、PNG（大小不超过 1MB）

**特点**:
- 不占用公众号素材库的100000个图片限制
- 专用于图文消息内容中的图片
- 返回可直接在图文消息中使用的图片URL

### 4. 永久素材工具 (`wechat_permanent_media`)

管理微信公众号永久素材。

**支持操作**:
- `add`: 上传永久素材（图片、语音、视频、缩略图）
- `add`: 上传永久图文素材（`type: news`）
- `update`: 更新永久图文素材中的指定文章
- `get`: 获取永久素材
- `delete`: 删除永久素材
- `list`: 获取素材列表（默认 `count=20`，使用官方上限；可显式传 `count` 覆盖）
- `count`: 获取素材总数统计

### 5. 草稿管理工具 (`wechat_draft`)

管理微信公众号图文草稿。

**支持操作**:
- `add`: 新建草稿
- `update`: 更新草稿中的指定文章
- `get`: 获取草稿详情
- `delete`: 删除草稿
- `list`: 获取草稿列表（默认 `count=20` 且 `no_content=1`，避免默认拉取正文；如需正文显式传 `noContent: 0`）
- `count`: 获取草稿总数

### 6. 发布工具 (`wechat_publish`)

管理微信公众号文章发布。

**支持操作**:
- `submit`: 发布草稿
- `get`: 获取发布状态
- `delete`: 删除发布
- `list`: 获取发布列表（默认 `count=20` 且 `no_content=1`，避免默认拉取正文；如需正文显式传 `noContent: 0` 或 `no_content: 0`）

### 7. 用户管理工具 (`wechat_user`)

管理微信公众号用户信息和数据统计。

**支持操作**:
- `get_user_list`: 获取用户列表（支持分页）
- `get_user_info`: 获取用户基本信息
- `batch_get_user_info`: 批量获取用户信息（最多100个）
- `set_remark`: 设置用户备注名
- `get_user_summary`: 获取用户增减数据
- `get_user_cumulate`: 获取累计用户数据

**使用场景**:
- 用户画像分析
- 用户增长追踪
- 用户信息管理

### 8. 标签管理工具 (`wechat_tag`)

管理用户标签，实现用户分组。

**支持操作**:
- `create`: 创建新标签
- `get_list`: 获取所有标签
- `update`: 编辑标签名称
- `delete`: 删除标签
- `batch_tagging`: 批量为用户打标签
- `batch_untagging`: 批量为用户取消标签
- `get_tag_users`: 获取标签下的用户列表

**使用场景**:
- 用户分组管理
- 精准营销
- 用户分层运营

### 9. 自定义菜单工具 (`wechat_menu`)

管理公众号底部菜单。

**支持操作**:
- `create`: 创建自定义菜单
- `get`: 查询当前菜单
- `delete`: 删除菜单
- `add_conditional`: 创建个性化菜单
- `delete_conditional`: 删除个性化菜单
- `get_selfmenu_info`: 获取菜单配置

**菜单类型**:
- click: 点击推事件
- view: 跳转URL
- scancode_push: 扫码推事件
- pic_photo_or_album: 拍照或相册发图
- location_select: 发送位置

**使用场景**:
- 功能导航
- 活动推广
- 自定义服务入口

### 10. 模板消息工具 (`wechat_template_msg`)

发送服务通知类模板消息。

**支持操作**:
- `send`: 发送模板消息
- `set_industry`: 设置账号所属行业
- `add_template`: 从模板库添加模板
- `get_all_templates`: 获取所有模板
- `delete`: 删除模板
- `get_industry`: 获取账号所属行业

**使用场景**:
- 订单通知
- 支付成功通知
- 预约提醒
- 物流更新

**注意**: 模板消息需要先在微信公众平台后台配置模板。

### 11. 客服消息工具 (`wechat_customer_service`)

在用户动作后48小时内主动发送消息。

**支持操作**:
- `send_text`: 发送文本消息
- `send_image`: 发送图片消息
- `send_voice`: 发送语音消息
- `send_video`: 发送视频消息
- `send_music`: 发送音乐消息
- `send_news`: 发送图文消息
- `send_mpnews`: 发送永久图文素材
- `get_records`: 获取客服聊天记录

**使用场景**:
- 用户咨询回复
- 售后服务
- 主动关怀

**限制**: 只能在用户产生动作后48小时内发送。

### 12. 数据统计分析工具 (`wechat_statistics`)

获取公众号运营数据分析。

**支持操作**:
- `get_article_summary`: 图文群发每日数据
- `get_article_total`: 图文群发总数据
- `get_user_read`: 图文统计数据
- `get_user_share`: 图文分享转发数据
- `get_upstream_message`: 消息发送概况
- `get_interface_summary`: 接口分析数据
- `get_interface_summary_hour`: 接口分时数据

**数据维度**:
- 用户分析
- 图文分析
- 消息分析
- 接口分析

**使用场景**:
- 运营数据分析
- 内容效果评估
- 接口性能监控

### 13. 自动回复工具 (`wechat_auto_reply`)

查询自动回复规则配置。

**支持操作**:
- `get_current_info`: 获取当前自动回复规则

**包含信息**:
- 关注后自动回复
- 消息自动回复
- 关键词自动回复

**使用场景**:
- 查看当前配置
- 调试自动回复规则

### 14. 群发消息工具 (`wechat_mass_send`)

向用户群发消息。

**支持操作**:
- `send_by_tag`: 根据标签群发
- `send_by_openid`: 根据OpenID列表群发
- `delete`: 删除群发
- `preview`: 预览群发消息

**支持消息类型**:
- mpnews: 图文消息
- text: 文本消息
- voice: 语音消息
- image: 图片消息
- mpvideo: 视频消息
- wxcard: 卡券消息

**限制说明**:
- 订阅号：每天只能群发1条
- 服务号：每月可群发4条
- 群发给全部用户需要管理员二次确认

**使用场景**:
- 内容推送
- 活动通知
- 节日问候

### 15. 订阅通知工具 (`wechat_subscribe_msg`)

发送订阅相关通知。

**支持操作**:
- `send`: 发送订阅通知

**官方 contract 状态**:
- 服务号订阅通知官方接口为 `/cgi-bin/message/subscribe/bizsend`，字段使用 `template_id`。
- 公众号一次性订阅消息官方接口为 `/cgi-bin/message/template/subscribe`。
- 当前实现按已核验的服务号订阅通知 `bizsend` contract 映射请求字段；详见 [WECHAT_OFFICIAL_API_CONTRACT.md](./WECHAT_OFFICIAL_API_CONTRACT.md)。

**特点**:
- 需要用户主动订阅或授权
- 可包含小程序跳转

**使用场景**:
- 服务进度通知
- 预约成功通知
- 重要事件提醒

**注意**: 订阅通知能力以微信官方文档和账号实际开通权限为准。

### 16. 入站消息收件箱工具 (`wechat_inbox`)

查询 Cloudflare Workers `/wx/callback/{accountId}` 写入的微信公众号入站消息/事件。

**支持操作**:
- `list_pending`: 查询待处理消息，支持分页、类型和 OpenID 过滤
- `list_all`: 查询全部消息，支持分页、类型和 OpenID 过滤
- `get`: 获取单条消息详情
- `mark_processed`: 将单条或批量消息标记为已处理，可附加备注

**处理模型**:
- Webhook 只做验签、必要时 AES 解密、写入 D1、快速返回 `success`
- 多账号部署中，Webhook 会先通过 URL 中的不透明 `accountId` 解析账号配置，再使用该账号的 Token / EncodingAESKey 验签解密；入站消息按 tenant/account 写入并按账号生成去重键
- Worker 不运行 cron、不做 AI 推理、不主动调用微信回复接口
- 外部 AI Agent 通过 `wechat_inbox` 拉取消息，决策后调用现有客服/自动回复等工具，再标记已处理

### 16. 二维码管理工具 (`wechat_qrcode`)

创建和管理微信公众号二维码。

**支持操作**:
- `create_temp`: 创建临时二维码（最长30天有效期）
- `create_permanent`: 创建永久二维码
- `get_url`: 通过 ticket 获取二维码图片URL

**二维码类型**:
- 临时二维码：最长30天，适用于活动推广
- 永久二维码：无过期时间，适用于渠道追踪

**使用场景**:
- 渠道追踪
- 线下推广
- 扫码关注
- 活动统计

### 17. 短链接工具 (`wechat_short_url`)

将长链接转换为微信短链接。

**支持操作**:
- `generate`: 生成短链接

**使用场景**:
- 二维码内容缩短
- 短信链接
- 分享链接优化

### 18. 评论管理工具 (`wechat_comment`)

管理已群发文章的评论功能。

**支持操作**:
- `open`: 打开文章评论
- `close`: 关闭文章评论
- `list`: 查看评论列表（支持分页和类型筛选）
- `mark_elect`: 标记精选评论
- `unmark_elect`: 取消精选标记
- `delete`: 删除评论
- `reply`: 回复评论
- `delete_reply`: 删除评论回复

**评论类型**:
- 0: 全部评论
- 1: 普通评论
- 2: 精选评论

**使用场景**:
- 文章互动管理
- 精选评论展示
- 用户互动回复

### 19. 黑名单管理工具 (`wechat_blacklist`)

管理公众号用户黑名单。

**支持操作**:
- `get_list`: 获取黑名单列表（支持分页）
- `block`: 拉黑用户（最多20个）
- `unblock`: 取消拉黑用户（最多20个）

**使用场景**:
- 恶意用户屏蔽
- 用户行为管理

**注意**: 被拉黑的用户无法收到公众号消息。

### 20. 客服账号管理工具 (`wechat_kf_account`)

管理公众号客服账号。

**支持操作**:
- `add`: 添加客服账号
- `update`: 修改客服账号
- `delete`: 删除客服账号
- `get_list`: 获取客服列表

**使用场景**:
- 多客服管理
- 客服人员配置

**注意**: 客服账号格式为 `账号@公众号昵称`。

### 21. 账号管理工具 (`wechat_account`)

管理公众号 API 调用配额。

**支持操作**:
- `clear_quota`: 重置 API 调用次数
- `get_quota`: 查询 API 调用次数配额

**使用场景**:
- API 调用频率监控
- 配额管理
- 调试接口限流

**注意**: 重置 API 调用次数每月只能操作10次。

## 📁 项目结构

```
src/
├── index.ts             # HTTP-only 库导出入口
├── mcp-tool/            # MCP 工具定义与共享 handler
│   ├── types.ts         # 类型定义
│   ├── inbox-store.ts   # 入站消息 store 接口
│   └── tools/           # 22 个 MCP 工具（媒体上传使用 Worker-safe wrapper）
├── wechat/              # 微信 API 客户端与 HTTP seam
│   ├── api-client.ts
│   ├── http-executor.ts
│   ├── workers-http-executor.ts
│   └── proxy.ts
├── worker/              # Cloudflare Workers Remote MCP、TokenOwner DO、Webhook
│   ├── index.ts
│   ├── media-tools.ts   # fileUrl / R2 / fileData 媒体上传；filePath 已移除
│   ├── inbox-store.ts
│   └── wechat-webhook.ts
├── storage/             # Workers D1 数据存储
│   ├── types.ts
│   └── d1-storage-manager.ts
└── utils/               # 工具函数
    ├── logger.ts
    ├── validation.ts
    └── version.ts
```

已移除：本地桌面端 `stdio`/CLI、`src/mcp-server/`、SQLite 存储、Node/Axios executor、基于本地 `filePath` 的媒体上传实现。

## 🔗 在 AI 应用中使用

支持 Streamable HTTP 的客户端可直接连接 Workers `/mcp`，并按 OAuth 授权流程登录：

```json
{
  "mcpServers": {
    "wechat-official-account": {
      "url": "https://<your-worker-domain>/mcp"
    }
  }
}
```

如果客户端暂不支持原生 Remote MCP，可使用 `mcp-remote` 作为本地桥接；这只是桥接远程 HTTP MCP，不是本项目的本地 stdio 服务器：

```json
{
  "mcpServers": {
    "wechat-official-account": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<your-worker-domain>/mcp"
      ]
    }
  }
}
```

迁移提示：
- 原本调用 `POST /api/wechat/tools/:toolName` 的 HTTP 消费者，应迁移为 OAuth 后的 MCP `tools/list` / `tools/call`。
- 原本使用本地桌面 stdio CLI 的客户端，应迁移到远程 `/mcp` 或 `mcp-remote https://<your-worker-domain>/mcp`。
- 微信公众号后台的服务器地址建议迁移为 `https://<your-worker-domain>/wx/callback/{accountId}`；旧 `/wx/callback` 只在显式或可安全推断单账号时兼容处理，多账号部署会返回迁移提示。
- `wechat_inbox` 用于查询 `/wx/callback/{accountId}` 写入的入站消息；Webhook 本身不会主动回复或调度任务。

### Remote-only `woa` CLI

`woa` 只调用远程 Worker REST API 或生成远程 `/mcp` 配置，不再启动本地 MCP/stdio/SSE 服务器，也不会在本机保存微信 AppSecret。

```bash
woa login --server https://<your-worker-domain> --token <oauth-token>
woa whoami
woa usage                         # 查看当前租户套餐、用量、重置时间与升级提示
woa tenant usage --tenant <id>     # 指定租户查看用量
woa account configure --tenant <id> --account <id> --app-id <wx...> --app-secret <secret>
```

## 🧪 开发指南

### 开发模式

```bash
# 安装依赖
npm install

# 构建项目
npm run build

# 类型检查
npm run check

# 代码检查
npm run lint

# 运行测试
npm test

# Workers 本地开发 / dry-run
npm run worker:dev
npx wrangler deploy --dry-run
```

### 构建和发布

```bash
# 构建项目
npm run build

# 预览 npm 包内容
npm run pack:dry

# 发布到 npm
npm publish
```

### OpenSpec 验证

```bash
openspec validate migrate-to-cloudflare-workers
```

## 📝 配置说明

### 环境变量

创建 `.env` 文件：

```env
# 开发模式（可选）
NODE_ENV=development

# 调试模式（可选）
DEBUG=true

# 跨域来源白名单（强烈建议生产环境设置）
CORS_ORIGIN=https://your-domain.com,https://another-domain.com

# 开启敏感字段加密（设置后启用 AES 加密存储）
WECHAT_MCP_SECRET_KEY=your-strong-secret-key

# 微信 API 出站代理（可选；用于公众号 IP 白名单/固定出口）
WECHAT_PROXY_URL=https://proxy.example.com/wechat-relay
WECHAT_PROXY_TOKEN=optional-relay-token

```

Workers 生产环境不要使用 `.env` 明文提交密钥；使用 `wrangler secret` 或 Cloudflare Secrets Store 绑定上文列出的 `WECHAT_*` / `OAUTH_*` secrets。

### 微信公众号配置

1. 登录微信公众平台
2. 进入「开发」->「基本配置」
3. 获取 AppID 和 AppSecret
4. 使用 `wechat_auth` 工具进行配置

## 🔒 安全说明

- 加密存储：设置 `WECHAT_MCP_SECRET_KEY` 后，`app_secret/token/encoding_aes_key/access_token` 以加密形式持久化（带 `enc:` 前缀标识）
- 日志脱敏：错误日志仅记录状态码或消息，避免泄露响应体与敏感信息
- 跨域白名单：生产环境务必设置 `CORS_ORIGIN` 为精确域名列表，避免 `*`
- 参数校验：22 个 MCP 工具参数使用 Zod 校验，降低不当输入风险
- 媒体上传：HTTP-only 运行时拒绝本地 `filePath`，仅支持 `fileUrl` / `r2Key` / `fileData`
- 切勿提交密钥：不要将 AppSecret、Token 等放入代码仓库或构建产物
- Remote MCP 安全：Workers `/mcp` 必须经 OAuth 访问；旧 `/api/wechat/tools/*` REST 工具执行面已移除

## 🤝 贡献指南

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🆘 支持

如果您遇到问题或有建议，请：

1. 查看 [Issues](https://github.com/xwang152-jack/wechat-official-account-mcp/issues) 页面
2. 创建新的 Issue
3. 联系项目维护者: xwang152-jack <xwang152@163.com>

## 🙏 致谢

- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议标准
- [微信公众平台](https://mp.weixin.qq.com/) - 微信公众号 API
- [Anthropic](https://www.anthropic.com/) - Claude Desktop MCP 支持

---

**注意**: 本项目仅供学习和开发使用，请遵守微信公众平台的使用条款和相关法律法规。

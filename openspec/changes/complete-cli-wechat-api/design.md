## Context

`@ziikoo/woa` 是 remote-only CLI。它已经保存可刷新的 OAuth 会话并能调用 Worker 管理 REST API，但只对草稿、发布列表、收件箱和媒体上传等少量能力提供命令。生产 `/mcp` 同时公开 23 个 `wechat_*` 工具和 4 个 `woa_*` 管理工具，工具 schema、账号注入、scope、quota 和审计都以 MCP 注册层为准。

如果为每个工具 action 新建 REST 路由和 CLI handler，会形成第二套公开 API，重复 Zod schema、scope 和 quota 规则，并在后续新增工具时继续漂移。项目已依赖 `@modelcontextprotocol/sdk`，因此 CLI 可以作为标准 Streamable HTTP MCP client 连接同一个 `/mcp`。

## Goals / Non-Goals

**Goals:**

- 让 CLI 能发现、描述并调用生产端当前及未来的全部 `wechat_*` MCP 工具。
- 复用现有 OAuth session 的刷新、轮换和 401 重试逻辑，不保存第二套 MCP token。
- 提供 JSON 文件、stdin 和内联 JSON 输入，并保持脚本可消费的 JSON 输出和稳定退出码。
- 对账号选择、scope 恢复提示和高风险 action 增加 CLI 防误操作保护。
- 补齐用户明确需要的 `woa draft add/update/get/count` 领域命令，同时不破坏已有 list/delete 输出。

**Non-Goals:**

- 不恢复本地 stdio/SSE MCP server、SQLite 或本地微信 API executor。
- 不复制 23 个工具为 23 组 Worker REST 路由。
- 不让 CLI 绕过 MCP 的 OAuth、tenant/account、quota、审计或 Zod 校验。
- 不在本次变更中改变微信公众号官方 endpoint contract 或新增新的微信工具。
- 不默认请求发布、群发等高权限 scope；完整权限必须由用户显式选择并重新授权。

## Decisions

### 1. 以标准 MCP 客户端作为完整能力底座

新增 `src/cli/mcp-client.ts`，使用 SDK `Client` 与 `StreamableHTTPClientTransport`。transport 的自定义 fetch 委托给 CLI 现有 OAuth fetch callback，因此沿用 token 提前刷新、refresh token 原子轮换和一次 401 强制刷新。

备选方案是扩展 `management-api.ts` 为全部微信 API 建 REST 镜像。该方案会重复工具 schema、scope、quota、账号注入和审计，维护成本更高，故不采用。

### 2. 稳定命令面为动态 API gateway 加少量领域别名

新增：

- `woa api list [--all]`
- `woa api describe <tool>`
- `woa api call <tool> [--input <json> | --file <path> | --stdin]`
- `woa mcp tools/describe/call` 作为相同实现的协议导向别名

`api` 默认只允许 `wechat_*`，避免把 SaaS 管理工具误称为微信公众号 API；`--all` 只扩展 list/describe。现有管理命令继续使用 REST。高频草稿命令映射到同一 MCP call helper。

### 3. 参数输入采用互斥 JSON 来源

调用参数必须来自零个或一个来源：`--input`、`--file`、`--stdin`。文件和 stdin 可避免长正文进入 shell history；解析结果必须是 JSON object。CLI 可在参数没有 `accountId` 时根据 `--tenant/--account` 或保存的默认上下文注入账号，但不得覆盖输入中显式且可访问的 `accountId`。

草稿 add/update 接受完整调用对象，也接受文章对象或文章数组并规范化为 `articles`。update 必须同时有 mediaId、index 和且仅一篇文章。

### 4. 危险调用使用精确确认值

维护集中式危险 action policy。删除、清理、拉黑、发布、群发、菜单替换等已知不可逆或大范围 action，必须提供 `--confirm <tool>:<action>`；`--dry-run` 输出脱敏后的目标和参数且不建立 MCP 调用。服务端原有 scope、确认、quota 与审计仍是最终边界。

不把“action 名未知”自动判为安全写操作：服务端新增工具在进入 CLI 通用调用前可被发现和描述，但未知写 action 需要显式 `--confirm <tool>:<action>`。

### 5. 完整 scope 通过显式 profile 获取

保留当前最小默认 scope。新增 `woa login --scope-profile wechat-full`，请求 context、account read/write、content read/write/publish 和 inbox read。普通 `woa login` 不自动扩大权限。MCP 返回 missing_scope 时，CLI 输出不含 token 的重新登录命令提示。

### 6. 输出与退出码

list、describe、call 默认输出 JSON。MCP `isError: true` 或协议错误必须设置非零退出码；文本 content 仍保留在 JSON 中，避免丢失结构。错误信息不得回显 Authorization、refresh token、AppSecret 或完整敏感输入。

## Risks / Trade-offs

- [SDK Streamable HTTP 会建立和关闭 MCP session，增加单次命令往返] → 每条 CLI 命令只建立一个 session，完成后可靠 close；不实现常驻进程。
- [CLI 与宿主可能持有不同 OAuth scope] → 明确它们是独立 grant；缺 scope 时只提示重新授权 CLI，不复用宿主凭据。
- [通用调用可能放大误操作风险] → 默认仅 `wechat_*`、集中危险 action policy、精确确认、dry-run、服务端 scope/quota/audit 多层保护。
- [工具 schema 后续变化导致领域别名漂移] → 完整能力始终由动态 list/call 保证；领域别名只做薄参数规范化并有契约测试。
- [旧 OAuth grant 没有 publish/inbox scope] → 保持可用；用户需要相关能力时显式执行 `--scope-profile wechat-full` 重新授权。

## Migration Plan

1. 先发布向后兼容的 CLI 版本；Worker `/mcp` 无需迁移或数据库变更。
2. 发布前验证 npm tarball、Node LTS、OAuth smoke 和全部工具发现契约。
3. 更新 README，推荐自动化使用 JSON 文件/stdin 和固定 CLI 版本。
4. 回滚时可恢复上一 CLI 版本；现有 REST 命令和服务端无需回滚。

## Open Questions

无。领域命令覆盖将从草稿补全开始；其它工具通过稳定的动态 API gateway 已获得完整 CLI 可达性，后续可按使用频率增加薄别名而不改变完整性合同。

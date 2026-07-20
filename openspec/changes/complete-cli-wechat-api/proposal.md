## Why

当前 `@ziikoo/woa` CLI 只通过管理 REST API 暴露少量公众号操作，例如草稿 list/delete，而 Remote MCP 已提供 23 个微信公众号运营工具。CLI 与 MCP 能力长期不对齐会迫使脚本用户依赖宿主 AI，并导致每新增工具都重复开发 REST 路由和命令封装。

## What Changes

- 为 CLI 增加 OAuth 复用的原生 Streamable HTTP MCP 客户端，支持发现、查看和调用服务端当前公开的全部工具。
- 增加稳定的 `woa api list`、`woa api describe <tool>`、`woa api call <tool>` 命令，并提供 `woa mcp tools/describe/call` 等价入口。
- 支持通过内联 JSON、JSON 文件或 stdin 提供工具参数，自动注入显式选择的 `accountId`，并保持机器可读 JSON 输出。
- 为草稿补齐 `add/update/get/count` CLI 子命令，并将其实现复用到通用 MCP 调用层；现有 list/delete 行为保持兼容。
- 增加完整微信运营 scope profile 和缺失 scope 的可执行恢复提示，同时保持默认登录最小权限。
- 对删除、群发、发布、菜单更新、凭据写入等高风险调用执行 CLI 侧确认策略；通用调用不得成为现有安全边界的绕过通道。
- 增加全部 `wechat_*` 工具可发现、可描述、可调用的契约测试和 CLI 输入/输出/安全回归测试。

## Capabilities

### New Capabilities
- `cli-wechat-api-parity`: 定义 remote-only CLI 对当前及未来微信公众号 MCP 工具的完整发现、调用、输入、安全和兼容行为。

### Modified Capabilities

无。

## Impact

- 主要修改 `src/cli/woa.ts`，并新增可测试的 MCP 客户端、参数输入和危险操作策略模块。
- 复用现有 `@modelcontextprotocol/sdk`，不增加生产依赖，不新增本地 MCP server 或微信 API executor。
- CLI OAuth 登录增加可选完整微信运营 scope profile；现有登录、REST 管理命令和配置文件保持兼容。
- 更新 `tests/cli-agent-workflow.test.mjs`、`test-tools.js`、README 和 CLI help；Worker `/mcp` 协议与 27 个工具本身不发生破坏性变更。

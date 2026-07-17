export const WOA_AGENT_BOOTSTRAP_COMMAND =
  'npx -y --registry=https://registry.npmjs.org --package @ziikoo/woa@latest woa help agent';

export const WOA_AGENT_PROMPT = [
  '请帮我在当前环境完成 WOA 微信公众号 MCP 接入，并在我确认后创建一篇只保存、不发布的连接测试草稿。',
  '',
  '第一步，运行并完整阅读当前最新版 WOA CLI 内置的 Agent 指南：',
  WOA_AGENT_BOOTSTRAP_COMMAND,
  '',
  '把该命令的输出视为本任务唯一、最新的执行规范，并以 `woa init` 作为唯一初始化入口，随后严格按指南完成能力探测、登录、微信 IP 白名单、公众号配置、宿主原生 OAuth、MCP 工具验证和测试草稿。需要我登录、授权、把 CLI 显示的固定出口 IP 加入公众号白名单、输入公众号凭据、确认目标或确认创建草稿时，请暂停让我操作；不要在聊天、命令参数、环境变量或日志中索取、读取、回显或记录任何凭据、Token 或完整 OAuth callback URL。不要发布、群发、删除或修改其他公众号内容。若环境缺少安全输入、远程 Streamable HTTP 或 OAuth 自动刷新能力，请停止，并只说明缺失能力和指南提供的恢复方式。',
].join('\n');

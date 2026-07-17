# Agent-first 微信 MCP 一键接入实施计划

- 状态：Draft，待产品与工程评审
- 日期：2026-07-18
- 设计模式：`REVIEW → DESIGN`
- 范围：极简官网、CLI 内置 Agent Help、`woa init` TUI、OAuth/公众号配置、宿主 MCP 验证与测试草稿
- 不在本文件中实施：具体业务代码、生产部署、客户端专属适配器
- 关联变更：[saas-onboarding OpenSpec](../../openspec/changes/saas-onboarding/)
- 设计约束：[Web anti-slop rules](./anti-ai-slop-rules.md)、[Astryx component choices](./astryx/woa-web-component-choices.md)

## 1. 结论

接入流程应从“网站向导”改为“Agent 执行任务”。公开网站只完成两件事：解释 WOA 能做什么，并把一段通用任务复制给用户的 Agent。

标准操作知识不再写在网页、不再分发独立 `SKILL.md`，也不写 Kimi、Codex、Claude Code 专属适配器。它随 `@ziikoo/woa` CLI 一起发布，由以下命令提供：

```bash
woa help agent
```

`woa help agent` 是唯一、版本化、离线可读的 Agent 接入契约。Agent 每次先读取当前 CLI 自带的指南，再调用 CLI、宿主原生 MCP 能力和 WOA MCP 工具完成任务。以后流程升级只发布新 CLI；用户升级 CLI 即获得新版 Skill。

```text
公开网站
  └─ 复制一段 Prompt
       └─ Agent 安装/升级 @ziikoo/woa
            └─ woa help agent（唯一流程真源）
                 ├─ CLI：TUI 引导登录、白名单、公众号配置和测试素材
                 ├─ 用户：身份验证、授权、微信 IP 白名单、秘密输入、草稿确认
                 └─ 宿主 Agent：添加标准远程 MCP、原生 OAuth、调用工具
                                      └─ 创建一篇未发布测试草稿
```

这里的“一键”是一次交接，不是无人值守。用户复制 Prompt 后可以离开网站，但以下动作必须由本人完成：

1. 在可信浏览器中登录并同意 OAuth scope。
2. 把 CLI 显示的当前 relay 固定出口 IP 加入微信公众号 IP 白名单。
3. 在 WOA 安全页面或本人控制的无回显终端中输入 AppID/AppSecret。
4. 确认目标公众号和“只创建、不发布”的测试草稿。

## 2. Task contract

> 当用户把官网 Prompt 交给任意具备命令执行和原生远程 MCP 能力的 Agent 时，Agent 应安装或升级 WOA CLI，完整读取 CLI 内置指南，引导用户完成固定出口 IP 白名单，随后完成公众号验证和宿主 OAuth，并通过宿主自身的 MCP 会话创建一篇未发布测试草稿。用户只处理身份、授权、白名单、秘密和最终副作用确认。

### 2.1 成功定义

只有以下事实全部成立，Agent 才能报告“WOA 配置完成”：

- 使用的是本次任务锁定的 `@ziikoo/woa` exact version，且 `woa help agent` 返回受支持的 contract version。
- CLI OAuth 已完成；其 access token 可自动刷新，但没有被复制到宿主 MCP 配置。
- CLI 从受控服务端取得当前微信 relay 出口 IP，用户已将全部当前 IP 加入目标公众号白名单。
- 用户确认的公众号为 `active`，AppID/AppSecret 已经过微信实时验证。
- 经 relay 获取微信 access token 的实时 probe 成功，证明白名单已经生效；用户口头确认不能替代该证据。
- 宿主原生 MCP 配置只有远程 `/mcp` URL，不含静态 Bearer 或 `Authorization` header。
- 宿主自己的 OAuth grant 已完成，宿主能发现 WOA 工具并成功调用 `woa_context`。
- 宿主成功调用只读 `wechat_draft(action=count)`，证明账号、relay 和微信 API 通道可用。
- 用户确认后，宿主通过 MCP 创建一篇未发布测试草稿；返回 `mediaId`，再按该 ID 读回成功。
- 重试相同 init run 不会静默覆盖公众号配置或创建第二篇测试草稿。

CLI 自身登录成功、CLI REST 请求成功、输出 MCP URL、CLI 自己完成 MCP probe，均不能替代“宿主原生 MCP 已可用”的证据。

### 2.2 非目标

- 不创建 Kimi、Codex、Claude Code 或其他客户端适配器。
- 不写入任何客户端的 Skill 目录，也不单独发布 Skill 包。
- 不恢复本地 MCP server、stdio、SSE、SQLite 或 `mcp-remote` bridge。
- 不创建永不过期 token，不把 CLI token 转交给宿主，不生成静态 Bearer 配置。
- 不在连接测试中发布、群发、改菜单、删内容或轮换生产凭据。
- 不让公开网页承担连接状态轮询、首次激活判断或完成页职责。

## 3. 当前实现与阻塞项

| 优先级 | 当前事实 | 必须修复 |
|---|---|---|
| P0 | `woa help agent` 尚不存在；任何 `help` 都只输出普通帮助 | 增加内置、版本化 Agent Help 和 JSON contract |
| P0 | `account configure` 强制通过 `--app-secret` 传秘密 | 禁止 Agent 路径使用 argv；改为安全浏览器 handoff 或无回显 TTY |
| P0 | 当前没有面向 init 的可信 relay 出口 IP contract | 从受控部署配置返回当前 IP，并以微信实时 token probe 验证白名单生效 |
| P0 | 未授权 `/mcp` 当前可能返回 bare Bearer challenge | 由 OAuth Provider 返回 RFC 9728 protected-resource metadata，保证原生 OAuth discovery |
| P0 | CLI OAuth 与 pending PKCE/DCR 状态会在授权完成前混入 active config | pending 与 active 分开保存，成功后原子切换，失败保留旧 session |
| P0 | 无 tenant 的已认证用户仍可能回退到全局默认账号 | 全部 Agent/REST/MCP 路径 fail closed，不得跨租户兼容回退 |
| P1 | `woa mcp config` 仍按 Codex/Claude 分支 | 新主流程只输出通用 MCP descriptor；旧命令不进入 Agent Help |
| P1 | CLI/REST 草稿只支持 list/delete | 增加测试素材准备；草稿创建仍由宿主调用现有 MCP 工具完成 |
| P1 | CLI 默认 scope 包含 publish、billing、audit 等 | 为 init 和目标 MCP 定义最小 scope，不默认授予发布权限 |
| P1 | 当前 CLI 以零散命令、原始 JSON 和英文提示为主，没有可恢复的初始化状态机 | 新增 `woa init` 渐进式 TUI；状态机与人类/Agent renderer 分离 |
| P1 | 网站有控制台、客户端标签页和长篇配置说明 | 公开首页改为业务说明 + 单一 Prompt；管理能力移到次级入口 |
| P1 | 当前测试没有真实宿主 OAuth、initialize、tools/list、tool call | 增加纯协议测试与真实 Agent 宿主验收，两者不能互相替代 |

公开 Prompt 在全部 P0 未完成、CLI 未发布到 npm `latest` 之前不得上线。

## 4. 最终用户流程

### 4.1 用户看到的流程

| 阶段 | Agent 自动完成 | 用户只需完成 |
|---|---|---|
| 1. 启动 | 检查 Node/npm、安装或升级 CLI、读取 `woa help agent` | 首次安装或全局写入需要确认 |
| 2. 注册/登录 | OAuth discovery、DCR、PKCE、打开或打印 URL | 登录、邮箱验证码、scope consent |
| 3. IP 白名单 | 从受控服务端读取当前 relay 出口 IP，显示复制值和微信后台操作位置 | 把全部当前 IP 加入目标公众号 IP 白名单 |
| 4. 公众号凭据 | 创建/选择默认资源、打开一次性安全输入页、轮询验证 | 确认公众号并输入 AppID/AppSecret |
| 5. MCP | 读取通用 descriptor，使用宿主原生能力添加远程 MCP | 浏览器授权；宿主要求时重启/重载 |
| 6. 验证 | 调用 `woa_context` 与 `wechat_draft(action=count)` | 无 |
| 7. 测试草稿 | 准备可复用测试封面、展示预览、通过 MCP 创建并读回 | 确认“只创建、不发布” |
| 8. 结束 | 输出证据、media ID、恢复/撤销命令 | 可以离开 |

正常桌面环境的人工中断应控制在四次：登录授权、微信 IP 白名单、秘密输入、测试草稿确认。需要宿主重启时增加一次明确 handoff；不能把重启前的状态误报为完成。

### 4.2 无浏览器服务器

- CLI 自动识别 headless 环境，并把授权 URL 交给用户在另一可信设备打开。
- callback code/full callback URL 由用户直接粘贴到本人的安全 CLI 输入，不经过 Agent 对话、argv 或日志。
- relay 出口 IP 由 CLI 显示为非敏感值；用户可在任意可信浏览器登录微信公众平台完成白名单配置。
- 公众号秘密输入优先使用一次性 HTTPS 页面；CLI 仅轮询非敏感状态。
- 宿主若不能安全完成远程 OAuth callback/refresh，返回 `host_oauth_capability_missing`，停止流程；不得降级为静态 Bearer。

### 4.3 宿主无法热加载 MCP

Agent 保存非敏感 `runId`，输出一条恢复指令并要求用户重启宿主。新会话重新执行 `woa help agent` 和 `woa init status --format json`，从宿主 OAuth/工具验证继续，不重复登录、建账号或准备素材。

## 5. 官网设计

### 5.1 信息架构

公开 `/` 使用无侧栏、无登录要求、无 API 轮询的单页。现有控制台概览迁移到 `/app`；公众号管理、账单和安全页保留为恢复/管理入口，但不进入首次接入主流程。`/login`、`/authorize`、一次性秘密输入和法律页属于必要的身份/协议页面，不计入公开营销信息架构。

页面只保留：

1. WOA 标识和一句业务说明。
2. 一段可复制 Prompt。
3. 主按钮 `复制给 Agent`。
4. 一句安全说明。
5. 页脚中的管理入口、隐私、条款和支持。

删除：客户端标签页、步骤条、MCP endpoint 卡片、Bearer 解释、token 生命周期说明、状态轮询、完成页、套餐和用量模块。

### 5.2 页面文案

- H1：`让 Agent 配好微信公众号 MCP`
- 说明：`连接后，你可以直接让 AI 管理公众号素材、草稿、发布与消息。复制下面的任务给 Agent，它会完成安装、登录、连接和测试。`
- 安全提示：`准备好公众号管理员权限、AppID 和 AppSecret。出口 IP 需要加入微信白名单；AppSecret 只在 WOA 安全页面或你自己的终端输入。`
- 主按钮：`复制给 Agent`
- 成功反馈：`已复制。回到 Agent 粘贴并发送；这个页面现在可以关闭。`

建议 Prompt：

```text
请帮我在当前环境完成 WOA 微信公众号 MCP 接入，并在我确认后创建一篇只保存、不发布的连接测试草稿。

第一步，运行并完整阅读当前最新版 WOA CLI 内置的 Agent 指南：
npx -y --registry=https://registry.npmjs.org --package @ziikoo/woa@latest woa help agent

把该命令的输出视为本任务唯一、最新的执行规范，并以 `woa init` 作为唯一初始化入口，随后严格按指南完成能力探测、登录、微信 IP 白名单、公众号配置、宿主原生 OAuth、MCP 工具验证和测试草稿。需要我登录、授权、把 CLI 显示的固定出口 IP 加入公众号白名单、输入公众号凭据、确认目标或确认创建草稿时，请暂停让我操作；不要在聊天、命令参数、环境变量或日志中索取、读取、回显或记录任何凭据、Token 或完整 OAuth callback URL。不要发布、群发、删除或修改其他公众号内容。若环境缺少安全输入、远程 Streamable HTTP 或 OAuth 自动刷新能力，请停止，并只说明缺失能力和指南提供的恢复方式。
```

网站不复制 endpoint、客户端命令或独立 Skill；这些内容只能来自已安装 CLI 的当前版本。

### 5.3 布局与可访问性

- 单列页面，正文最大宽度 720px；桌面外边距 32px，移动端 16px。
- H1、说明、Prompt、按钮按单一阅读轴左对齐；不使用卡片拼盘或装饰性插图。
- Prompt 使用只读文本区或等价可选择控件；命令行可自身横向滚动，页面不能横向滚动。
- 主按钮在 320/390px 宽度占满可用宽度，最小触控高度 44px。
- 复制成功用 `role="status"` 和 `aria-live="polite"` 持续反馈，不移动焦点。
- Clipboard API 失败时自动选中文本并提示 `⌘/Ctrl+C`，不能静默失败。
- 200%/400% zoom、键盘、读屏和 reduced-motion 均可完成复制。
- 页面不尝试自动打开终端、Agent 或自定义 URL scheme；按钮不能标成“立即安装”。

## 6. CLI 内置 Agent Help 与 init TUI

### 6.1 命令面

```text
woa --help
woa --version
woa help agent [--format markdown|json]
woa init [--server <url>] [--headless] [--plain]
woa init --agent [--server <url>] [--headless] --format jsonl
woa init status [--run <runId>] [--format json]
woa init resume <runId> [--plain]
woa init resume <runId> --agent --format jsonl
woa mcp descriptor [--format json]
```

普通 `--help` 只增加一行入口说明，完整 Skill 由 `woa help agent` 输出，避免把所有用户帮助变成长文。

`woa init` 是唯一初始化编排入口：

- 直接运行 `woa init` 时进入面向用户的渐进式 TUI，逐步显示当前状态、为什么需要该动作和下一步。
- Agent 运行 `woa init --agent --format jsonl` 时不出现交互式问答，只输出 typed `nextAction`；所有需要用户参与的动作都显式暂停。
- 已完成步骤根据服务端事实自动跳过；重复运行不会重复创建账号、OAuth grant、永久素材或测试草稿。
- 每个持久检查点都保存非敏感 `runId`；`Ctrl+C`、网络中断和宿主重启后保留终端历史，并只在 checkpoint 保存成功后打印锁定 exact version 的唯一恢复命令。
- `init` 完成平台侧步骤后继续引导宿主添加远程 MCP、完成原生 OAuth 和真实工具验证，但不会把 CLI probe 冒充为宿主成功。
- 旧的零散 `login`、`account configure`、`mcp descriptor` 等命令继续作为高级/诊断能力；首次接入文档不要求用户手工拼接它们。

人类引导模式只显示一个当前动作，例如：

```text
WOA 初始化 · run_opaque

✓ CLI 与服务端兼容
✓ 已登录 WOA
→ 配置微信公众号 IP 白名单

请把以下固定出口 IP 加入目标公众号白名单：
101.34.57.185

完成后按 Enter 继续；按 Ctrl+C 可稍后使用下列命令恢复：
npx -y --registry=https://registry.npmjs.org --package @ziikoo/woa@2.3.0 woa init resume run_opaque
```

完成标记只来自持久事实。终端打印过 IP、用户按过 Enter 或 Agent 声称已操作，都不能代替后续微信 access-token probe。

### 6.2 TUI 交互设计

采用渐进式 prompt TUI，而不是 alternate-screen 全屏应用：初始化是线性、低频任务，用户需要保留已经复制的 IP、错误上下文和恢复命令。不得清屏、进入 alternate screen 或回写已经完成的历史；仅活动 spinner 行允许短暂重绘，退出后已完成步骤必须保留在 scrollback。

首版锁定 `@clack/prompts@0.11.0` 并提交 lockfile，通过 Node 18/20 双版本 smoke 后才发布。当前 `1.x` 要求 Node 20.12+；若以后采用 `1.x`，必须单独决定运行时升级，不能在本变更中偷偷提高 `engines.node`。

TUI 页面结构固定为：

```text
WOA 初始化 · 3/8

✓ 环境检查
✓ WOA 登录
→ 微信 IP 白名单
○ 公众号凭据
○ 远程 MCP
○ 宿主 OAuth
○ 工具验证
○ 测试草稿

当前操作
把 101.34.57.185 加入目标公众号 IP 白名单。

[o] 打开微信公众平台  [c] 复制 IP  [Enter] 我已在微信后台保存  [q] 稍后继续
```

交互规则：

- 同一时刻只有一个主动作；完成步骤压缩为一行，未完成步骤只显示名称，不提前暴露细节。
- 状态同时使用符号和文字：`✓ 已完成`、`→ 当前`、`! 需处理`、`○ 未开始`，不能只依赖颜色。
- `Enter` 只表示用户已执行动作，不能直接标记服务端事实完成；白名单、OAuth 和微信能力仍需真实 probe。
- `o` 仅在本地桌面且用户确认后打开浏览器；SSH/headless 只打印 URL。
- `c` 尝试系统剪贴板；不可用时保持 IP 为可选择纯文本并给出复制提示，不使用不可靠的自定义 URL scheme。
- spinner 只用于预期短于 8 秒的网络动作；超时后切换为静态“仍在等待”及重试/退出选项，避免无限动画。
- 错误就地显示“发生了什么、保留了什么、下一步是什么”；默认不打印 stack，`--debug` 只给出已脱敏日志位置。
- `q` 只在明确显示的动作菜单中表示“稍后继续”，不能成为会吞掉文本输入的全局快捷键。
- 动作菜单中的 `q` 表示正常暂停：原子保存检查点，输出 `paused`，打印恢复方式并以 `0` 退出；`Ctrl+C` 表示信号中断，best-effort 保存后以 `130` 退出，第二次 `Ctrl+C` 立即退出。
- 正常完成、暂停、异常、`SIGINT`、`SIGTERM` 和 `SIGHUP` 都必须恢复光标、raw mode 和输入回显；后两种信号只做有时限的 best-effort checkpoint，再保留对应信号退出语义。
- 必须先原子保存检查点，再声明“可恢复”。保存失败返回 `checkpoint_save_failed`，不得打印会误导用户的恢复成功文案。
- renderer 永远不接收或展示 OAuth token、AppSecret、callback code/full callback URL。仅人类交互模式可调用独立的无回显 secure-input 模块；关闭安全输入后，TUI 只收到 `verified` 或稳定错误码。

状态反馈必须覆盖：

| 状态 | TUI 表达 | 可用动作 |
|---|---|---|
| 检查中 | 当前步骤 + 已命名的短时进度 | 等待或 `Ctrl+C` 保存退出 |
| 等待用户 | 暂停进度，只显示一个具体动作及原因 | 打开、复制、确认或稍后继续 |
| 等待外部系统 | 8 秒后停止 spinner，显示最后成功事实和等待对象 | 重试、查看脱敏诊断或稍后继续 |
| 验证失败 | 就地显示问题、已保留内容和稳定错误码 | 修正后重试或输出恢复命令 |
| 部分完成 | 已完成步骤保持 `✓`，失败步骤保持当前 | 只从失败步骤恢复，不重做前序副作用 |
| 已暂停 | 原子保存后恢复终端，显示 `runId` 和唯一恢复方式 | 正常退出码 `0` |
| 信号中断 | best-effort 保存并恢复终端；不伪造保存成功 | `SIGINT=130`；其他信号保留对应语义 |
| 不支持 | 说明缺失能力和安全降级，不显示虚假成功 | 纯文本人工路径或停止 |
| 已完成 | 显示宿主工具调用证据、测试草稿状态和 `mediaId` | 离开、查看或执行需再次确认的撤销动作 |

终端能力与降级：

| 环境 | 输出模式 | 行为 |
|---|---|---|
| stdin/stdout 均为 TTY，支持 ANSI | 渐进式 TUI | 默认模式 |
| stdin/stdout 均可交互，且指定 `--plain`、`WOA_PLAIN=1` 或 `TERM=dumb` | 纯文本向导 | 使用完整文字和 ASCII 状态；无单键快捷键、动画、颜色或光标控制 |
| `NO_COLOR` | 无颜色 TUI | 禁用颜色；状态仍以文字和符号表达，不改变流程语义 |
| `--agent` | JSONL | 默认且只允许 `--format jsonl`；不读取按键、不启动 prompt 或秘密输入 |
| stdin/stdout 任一非 TTY，或 `CI=true` | 单次 JSONL | 输出一个完整状态事件后退出；即使传入 `--plain` 也不得等待不可见输入 |
| 窄终端（小于 60 列） | 单列紧凑 TUI | 隐藏辅助说明但不隐藏当前动作、IP、错误和恢复命令 |

终端无法可靠探测读屏软件，因此不能声称自动识别读屏环境。`--help`、Agent Help 和每次 TUI 开头都提供 `--plain` 提示；纯文本模式是读屏、日志采集和异常终端的正式支持路径，不是故障回退。

实现层必须把状态机、effect runner 与 renderer 分离：`src/cli/init.ts` 只产生状态和 actions；`src/cli/init-runner.ts` 负责 use case、AbortController、信号、checkpoint 与并发恢复；`src/cli/init-tui.ts` 渲染 TUI；`src/cli/init-jsonl.ts` 渲染机器协议；`src/cli/terminal-capabilities.ts` 只负责 TTY/ANSI/CI/宽度探测。renderer 不能直接调用 REST、写配置或推进 phase。所有 renderer 使用同一组状态 fixtures；任何界面确认都只能提交 action，持久完成状态仍由 use case/服务端事实推进。

当前仅有代码与方案审查证据，真实键盘、SSH、中文宽度、读屏和中断恢复行为在实现前均为 `Unverified`；不得仅凭静态示例宣称可访问性已通过。

### 6.3 唯一真源

新增 `src/cli/agent-help.ts`，以结构化 manifest 作为唯一源，分别渲染 Markdown 和 JSON：

```ts
type AgentHelpManifest = {
  schemaVersion: 1;
  cliVersion: string;
  purpose: string;
  safetyRules: string[];
  capabilityChecks: string[];
  workflow: AgentWorkflowStep[];
  successCriteria: string[];
  stopConditions: string[];
};
```

要求：

- 内容静态打包进 CLI，离线可读；服务器响应不得拼入可执行指令。
- 不出现客户端品牌、配置路径或产品专属命令。
- 不建议 `--token`、`--app-secret`、静态 header 或复制 callback URL 给 Agent。
- 明确 CLI OAuth 与宿主 MCP OAuth 是两个 grant，凭据不可互换。
- 要求 Agent 通过 `woa init` 读取服务端当前 relay 出口 IP，暂停等待用户更新公众号白名单；Help 本身不保存 IP 常量。
- 明确宿主能力缺失、需要重载、无安全输入和 OAuth 不支持时的停止条件。
- 输出 `cliVersion`、contract `schemaVersion` 和最小 server compatibility。
- README 和网页只引用该命令，不复制内部步骤，防止三份文档漂移。

### 6.4 Agent 可解析的状态

`woa init --agent --format jsonl` 每行只输出一个稳定事件：

```json
{
  "schemaVersion": 1,
  "type": "action_required",
  "sequence": 4,
  "cliVersion": "2.3.0",
  "packageVersion": "2.3.0",
  "runId": "run_opaque",
  "runVersion": 7,
  "phase": "wechat_ip_allowlist_required",
  "nextAction": {
    "kind": "update_wechat_ip_allowlist",
    "ips": ["101.34.57.185"],
    "source": "server",
    "configVersion": "egress-2026-07-17",
    "reason": "请由用户将全部当前出口 IP 加入目标公众号白名单"
  },
  "resume": {
    "command": "woa",
    "args": ["init", "resume", "run_opaque", "--agent", "--format", "jsonl"],
    "packageVersion": "2.3.0"
  }
}
```

`type` 是 discriminated union，只允许：

```text
state | action_required | paused | error | done | unsupported
```

同一 run 的 `sequence` 单调递增，`runVersion` 用于恢复时的 CAS/lease 冲突检测。每行必须是 UTF-8、单行 JSON 并以换行结束；禁止 BOM、pretty-print、banner、日志、npm/CLI 提示、spinner 或终端控制符混入 stdout。Agent 需要判断流程的全部状态都在 stdout；stderr 只允许非协议的脱敏诊断，且同样不能含 ANSI 或秘密。

`nextAction.kind` 只允许通用语义：

```text
confirm_install | open_url | wait | choose_target | secure_user_input
update_wechat_ip_allowlist | add_remote_mcp | start_native_oauth
reload_host | call_mcp_tool
confirm_test_draft | done | unsupported
```

stdout 仅输出 contract/event；人类说明写 stderr。结构化输出永远不能包含 token、authorization code、PKCE verifier、AppSecret 或完整 callback URL。

`resume` 由本地可信代码基于当前 exact package version 构造；服务端文本不能进入 `command` 或 `args`。所有 action payload 使用 schema 字段白名单，未知字段或服务端返回的可执行内容一律 fail closed。写入下游 pipe 遇到 `EPIPE` 时静默结束并保留检查点，不打印 stack。

退出码固定为：合法状态/等待人工/暂停 `0`，运行错误 `1`，参数或 schema 错误 `2`，`SIGINT` 为 `130`。Agent 必须读取最后一个协议事件，不能仅靠退出码推断业务状态。

### 6.5 通用 MCP descriptor

CLI 不生成客户端格式，只返回标准事实：

```json
{
  "name": "wechat-woa",
  "transport": "streamable-http",
  "url": "https://woa.ziikoo.app/mcp",
  "authentication": {
    "type": "oauth2",
    "protectedResourceMetadata": true,
    "pkce": "S256",
    "dynamicClientRegistration": true,
    "refreshToken": true
  },
  "headers": {}
}
```

宿主 Agent 根据自身原生能力消费 descriptor。CLI 不判断产品名、不写客户端配置、不运行专属命令。若宿主没有可用的远程 MCP 管理能力，Skill 让 Agent 明确降级为人工配置；CLI probe 不能冒充宿主安装成功。

## 7. 安全的人机交接

### 7.1 安装与供应链

- 官网只使用 npm 官方 registry；发现自定义 registry、需要 `sudo` 或 package identity 不一致时停止并确认。
- 首次解析 `latest` 后记录 exact version 与 registry integrity，本次 run 后续不得重新解析到不同版本。
- npm 发布开启 provenance，并保护 dist-tag 提升、发布 token 和 release workflow。
- CLI 输出自身 version；server 拒绝不兼容 contract 时给出升级命令，而不是远程注入新指令。

### 7.2 微信 IP 白名单

- Worker 从受控的非敏感部署配置 `WECHAT_EGRESS_IPS` 返回当前 relay 出口 IP 列表，不从请求 header、用户输入或 DNS 临时解析结果推断。
- 当前生产 relay 为 `httpproxy.ziikoo.com.cn`，固定出口为 `101.34.57.185`；IP 只进入部署配置和 init 响应，不写死在官网 Prompt、CLI Agent Help 或前端代码。
- `woa init` 在秘密输入前返回 `update_wechat_ip_allowlist`，显示需要复制的全部当前 IP，并等待用户确认已经在目标公众号后台保存。
- 用户确认后继续 AppID/AppSecret 验证。只有经 `httpproxy` relay 获取微信 access token 成功，才能把白名单状态标为 `verified`。
- 微信返回白名单错误时统一映射为 `wechat_ip_not_allowlisted`，再次返回当前 IP 和恢复步骤；不能让用户重新安装 CLI 或重新做宿主 OAuth。
- relay 迁移应支持旧、新出口 IP 的重叠窗口；先让用户加入新 IP 并完成 probe，再移除旧 IP，避免切换期间中断。

### 7.3 AppSecret

默认采用一次性 HTTPS handoff：

1. CLI 创建绑定当前 Operator/tenant/account 的短期 init session。
2. CLI 打开或打印一次性 URL；用户在浏览器直接输入 AppID/AppSecret。
3. 服务端经固定出口 relay 实时验证，成功后加密保存；白名单或凭据验证失败时，秘密不写入公众号正式配置。
4. CLI 只轮询 `pending/verified/failed` 和稳定错误码，不读取秘密。
5. handoff token 只存哈希、10 分钟过期、单次使用，只有写入能力且不能读取已经提交的凭据；页面要求同一 Operator 登录或重新确认身份。
6. 首次使用后换 HttpOnly cookie 并清理地址栏；响应使用 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`，页面不加载第三方脚本。

本地可信终端可提供无回显 TTY 作为回退，但只允许用户直接运行的人类模式调用。Agent/JSONL/pipe/CI 模式绝不读取 AppSecret 或完整 OAuth callback URL，只发出 `secure_user_input` 并暂停。秘密不得进入 init event、state、checkpoint、本地配置或 logger；HTTPS 请求完成后立即释放内存引用。

现有会回显完整 callback URL 的 `readCallbackUrlFromTerminal` 必须由同一 secure-input 模块替换。Agent Help 不得使用 `--app-secret <value>`、环境变量、管道或聊天传递秘密；无安全通道时返回 `secure_input_required`。

### 7.4 OAuth

- CLI init grant 使用 account/context 所需最小 scope；不含 publish、billing、audit、tenant write。
- 宿主 MCP grant 默认只含 `wechat.mcp`、context/account read 和 content read/write；发布权限以后按需重新授权。
- pending DCR/PKCE 与 active session 分文件或分区保存，OAuth 完成后原子切换。
- CLI 配置目录 0700、文件 0600，拒绝 symlink、不安全 owner 和位于项目仓库中的 config path。
- access token 自动刷新、refresh token rotation 和撤销继续由各自 OAuth client 负责。
- Provider/OAUTH_KV 是 grant/token 真源；D1 shadow session 不参与授权判断。

## 8. 测试草稿设计

连接测试只创建草稿，绝不 publish。

1. CLI 为当前账号上传或复用一张版本化 WOA 测试封面，返回 `thumbMediaId`；素材按 checksum 去重。
2. Agent展示固定预览：标题 `WOA MCP 连接测试`，正文说明创建时间、未发布和删除方式。
3. 用户确认账号、标题、封面和“只创建、不发布”。
4. 宿主通过现有 `wechat_content_publish(action=create_draft)` 调用 MCP，传入 `thumbMediaId` 和 `idempotencyKey=woa-init:<runId>`。
5. 服务端按 tenant/account/tool/idempotency key 持久化结果；重试返回同一 `mediaId`。
6. 宿主调用 `wechat_draft(action=get)` 读回标题；Agent 最终只报告脱敏账号、验证时间、`mediaId` 和删除命令。

若微信权限不支持永久封面/草稿、relay 不可用或用户拒绝创建，状态应分别为 `draft_capability_missing`、`wechat_relay_unavailable` 或 `test_draft_declined`。这些情况可报告“基础连接完成”，但不得报告“端到端测试完成”。

删除测试草稿仍是独立破坏性操作，必须再次确认；连接流程不能自动清理。

## 9. 状态、恢复与错误

### 9.1 两层状态

- CLI init 状态：安装、CLI OAuth、目标账号、当前出口 IP、白名单确认、公众号验证、测试素材准备。
- 宿主状态：远程 MCP 已添加、宿主 OAuth、工具发现、只读调用、测试草稿。

CLI 可以为协议诊断执行自己的 MCP initialize/tools/list，但该结果必须标为 `cli_protocol_probe`，不能把宿主状态推进为成功。

### 9.2 恢复原则

- 每次流程创建非敏感 `runId`；它不是授权凭证，恢复时仍验证当前 Operator、tenant 和 account。相同 run 重入先读取远端事实，再执行下一步。
- checkpoint 采用临时文件 + fsync + rename 原子写；必须保存成功后才输出结构化恢复方式。恢复锁定本次 exact CLI version，不能重新解析 `latest`。
- 并行 resume 使用 lease/CAS 与 `runVersion`；冲突返回 `init_run_conflict`，不能让两个 runner 同时执行副作用。
- 唯一且未配置的默认公众号可自动选择；多账号、不同 AppID、准备覆盖已有凭据时必须让用户选择。
- OAuth 中断不破坏旧 active session；新的成功后再 supersede 旧 grant。
- 网络超时后先 reconcile，再重试；不能盲目重建账号、grant、素材或草稿。
- 宿主重启后用 `runId` 恢复；已经成功验证并持久化的秘密不得重复提交。若一次性输入页在提交前过期，必须重新创建安全 handoff 并由用户再次输入。
- 回滚只撤销本次 grant、init session 和本次本地非敏感配置；不能自动恢复/覆盖 AppSecret。

### 9.3 稳定错误码

```text
node_runtime_missing
official_registry_required
cli_upgrade_required
browser_action_required
secure_input_required
oauth_pending
oauth_revoked
target_selection_required
wechat_invalid_credentials
wechat_egress_ip_unavailable
wechat_ip_not_allowlisted
wechat_relay_unavailable
host_mcp_capability_missing
host_oauth_capability_missing
host_reload_required
target_tool_verification_failed
draft_asset_required
test_draft_confirmation_required
test_draft_declined
init_run_expired
init_run_conflict
checkpoint_save_failed
timeout
```

错误详情是数据，不得被 Agent 当作 shell 指令执行。

## 10. 文件级实施拆分

### Phase 0：契约与安全决策

- `C-01`：在 `saas-onboarding` 新增 `agent-guided-onboarding` capability。
- `C-02`：同步 `remote-cli-onboarding`、`public-identity-onboarding`、`tenant-wechat-resource-onboarding`、`mcp-management-onboarding`、`astryx-web-entrypoint` 和 `saas-security-operations` specs。
- `C-03`：新增 ADR：CLI Help 是唯一 Skill 真源；`woa init` 使用渐进式 TUI 且与状态机分离；无客户端适配器；human-in-the-loop；relay 出口 IP 的受控真源与轮换；最小 scope；npm latest 风险；测试草稿幂等且不发布。
- `C-04`：明确 supersede 现有“默认全 owner scopes”决策的 Agent init 部分。
- `C-05`：运行 `openspec validate saas-onboarding`，作为编码入口门禁。

### Phase 1：OAuth 与租户安全基础

- `BE-01`：修改 `src/worker/index.ts`，让未授权 `/mcp` 走标准 Provider challenge；验证 RFC 9728/8414、DCR、PKCE、refresh metadata。
- `BE-02`：删除无 tenant 时的全局默认账号回退，所有 Agent/REST/MCP 请求 fail closed。
- `BE-03`：Provider grant/token 继续作为唯一真源；真实撤销失败时不能先把 D1 标成功。
- `BE-04`：为 init 与宿主 MCP 定义最小 scope policy，发布权限按需追加。
- `CLI-01`：把 active OAuth session 与 pending PKCE/DCR 分离，授权成功后原子提交。
- `QA-01`：覆盖旧 token、refresh rotation、撤销、跨租户拒绝、无浏览器 callback 和短 TTL 自动刷新。

### Phase 2：CLI 内置 Skill 与 `woa init` 编排

- `CLI-02`：在 `src/cli/woa.ts` 增加 `--version`、`help agent`、`init`、`init status/resume` 和 `mcp descriptor` dispatch。
- `CLI-03`：新增 `src/cli/agent-help.ts`，从同一 manifest 渲染 Markdown/JSON。
- `CLI-04`：新增 `src/cli/init.ts`，只实现 run、phase、typed nextAction、resume 和状态转移，不包含终端渲染或直接网络调用。
- `CLI-10`：新增 `src/cli/init-runner.ts`，集中负责 effect adapter、AbortController、信号、原子 checkpoint、lease/CAS 和 use case 调用；状态机和 renderer 均不直接执行网络副作用。
- `CLI-11`：新增 `src/cli/secure-input.ts`，只为直接人类模式提供无回显输入，替换现有会回显 callback URL 的读取路径；Agent/pipe/CI 调用一律拒绝。
- `TUI-01`：在 runtime `dependencies` 增加精确版本 `@clack/prompts@0.11.0` 并提交 lockfile；该版本 metadata 未声明 Node engine，不能仅凭版本号宣称兼容，必须以最低 Node 18/20 pack smoke 为证据。升级到要求 Node 20.12+ 的 `1.x` 必须单独决策。
- `TUI-02`：新增 `src/cli/terminal-capabilities.ts`，探测 stdin/stdout TTY、CI、`NO_COLOR`、`WOA_PLAIN`、`TERM=dumb`、终端宽度和 `--plain`；不伪造读屏自动探测。
- `TUI-03`：新增 `src/cli/init-tui.ts`，只消费 init events，提供步骤轨、当前动作、confirm/select/spinner、取消与恢复显示。
- `CLI-05`：新增 `src/cli/init-jsonl.ts`，保证 Agent 模式 stdout 为无 ANSI、无 prompt 的稳定 JSONL。
- `CLI-06`：新增 `src/cli/mcp-descriptor.ts`，只输出标准 remote MCP/OAuth 事实。
- `CLI-07`：新增 `src/cli/secure-config.ts`，强制 0700/0600、原子写、owner/symlink/path 检查。
- `CLI-08`：旧 `mcp config codex|claude` 从 Agent Help 和网页移除；是否保留一版 deprecated alias 由兼容性 ADR 决定。
- `QA-02`：快照 Agent Help，断言无客户端品牌、静态 Bearer、argv secret、要求把 callback URL 交给 Agent 的步骤和越权动作。
- `QA-TUI-01`：使用伪 TTY 覆盖 40/80/120 列、中文宽度、键盘操作、Ctrl+C/SIGTERM/SIGHUP、浏览器失败、剪贴板失败、spinner timeout、`--plain`、`NO_COLOR`、CI 和 pipe；拒绝 `ESC[?1049h/l`、`ESC[2J` 等全屏/清屏序列，并确认历史保留在 scrollback。
- `QA-TUI-02`：断言 JSONL 与 TUI 使用同一状态 fixtures；逐行校验 discriminated schema、sequence/runVersion、structured resume、stdout 纯净、退出码、EPIPE、并行 resume、checkpoint 写失败与 exact-version 恢复。Agent 模式 stdout/stderr 不得出现 ANSI、光标控制符、秘密或交互等待。
- `QA-TUI-03`：以 3–5 名未参与设计的目标用户做首次任务测试；不提供路径提示，验证其能说出当前步骤、唯一下一步和恢复方式，且不会把 AppSecret/Token 发进聊天。任何安全错误或重复出现的阻塞都必须修复并复测。

### Phase 3：微信白名单、安全秘密 handoff 与幂等测试素材

- `DB-01`：新增最小 `agent_init_runs`/idempotency migration；只存非敏感状态、素材 ID、草稿 ID、过期时间。
- `BE-05`：增加一次性 HTTPS credential handoff，token 哈希、短 TTL、单次使用、clean URL 与审计脱敏。
- `BE-06`：在 `src/worker/management-api.ts` 增加受保护的 init context，读取 `WECHAT_EGRESS_IPS` 并返回当前 IP、配置版本和更新时间；不返回 relay URL/token。
- `CLI-09`：`woa init` 先发出 `update_wechat_ip_allowlist`，展示全部当前 IP 并等待用户确认，再打开/打印 credential handoff URL。
- `BE-07`：通过 relay 验证 AppID/AppSecret；成功后再加密保存，白名单失败映射 `wechat_ip_not_allowlisted` 并附当前 IP。
- `BE-08`：增加测试封面上传/复用 use case，按账号和 checksum 幂等。
- `BE-09`：修改 `src/mcp-tool/tools/content-publish-tool.ts` 及 Worker 注册层，为 MCP 写操作增加 tenant/account/tool/idempotency key 结果复用，覆盖测试草稿重试。
- `QA-03`：验证 IP 来自受控配置而非前端硬编码；实际 token probe 成功前不标记白名单完成；secret 不进入 argv、聊天模拟 transcript、config、stdout/stderr、日志、analytics 或 D1 明文字段。

### Phase 4：极简公开网站

- `WEB-01`：把现有首页概览移到 `web/src/routes/app.tsx`，让 `web/src/routes/index.tsx` 成为公开 Agent-first 页面。
- `WEB-02`：新增 `web/src/lib/agent-prompt.ts`，只维护短 bootstrap Prompt；不复制 Skill 内容。
- `WEB-03`：新增可访问复制控件与手动 fallback；成功后明确页面可关闭。
- `WEB-04`：修改 `web/src/components/AppChrome.tsx`，公开首页不请求 `/me`/health，不渲染 SideNav/MobileNav。
- `WEB-05`：从 `web/src/routes/mcp.tsx` 与 `web/src/lib/mcp-config.ts` 的主流程移除客户端 tabs/命令，保留通用诊断或迁移提示。
- `WEB-06`：更新 `web/src/styles/theme.css`，只增加单列 landing archetype，不创建新视觉系统。
- `QA-04`：更新 SSR smoke 与截图，覆盖 1440/390/320px、200%/400% zoom、键盘、读屏和 Clipboard 失败。

### Phase 5：宿主 MCP 与测试草稿验收

- `QA-05`：纯协议测试：401 challenge → discovery → DCR/PKCE → token → initialize → initialized → tools/list → tools/call。
- `QA-06`：真实宿主测试：每种宿主使用隔离 HOME、全新 grant；只按同一 `woa help agent` 和 `woa init --agent` 操作，不使用测试专属适配器；用户将 init 返回的全部出口 IP 加入测试公众号白名单。
- `QA-07`：白名单保存后必须先经 relay 成功获取微信 access token；宿主再成功调用 `woa_context`、`wechat_draft(action=count)`、`wechat_content_publish(action=create_draft)` 和 `wechat_draft(action=get)`。
- `QA-08`：相同 `runId` 在 OAuth timeout、宿主重启和草稿响应丢失后恢复，不重复创建资源/素材/草稿。
- `QA-09`：无浏览器、无安全输入、无远程 MCP、无自动 refresh、无热加载分别得到真实降级/停止结果。
- `QA-10`：短 TTL 隔离部署证明宿主和 CLI 都能刷新 token；生产不增加测试后门。
- `QA-11`：为内置 Agent Help 建立桌面首次接入、headless、多账号冲突、OAuth 能力缺失四组 eval；比较“读取 Help”与“只有官网短 Prompt”的结果，断言秘密不进对话、没有客户端分支、停止条件正确且测试草稿不发布。

### Phase 6：发布

- `REL-01`：开启 npm provenance，运行 `npm run check`、`npm run lint`、`npm test`、`npx wrangler deploy --dry-run` 和 OpenSpec validation。
- `REL-02`：对 `npm pack` tarball 在干净的最低受支持 Node 18 和 Node 20 环境执行 `npm install --omit=dev --engine-strict`、import、TTY、`--plain`、pipe/CI、Agent JSONL、暂停/信号 smoke；检查包体积、启动时间、光标恢复与退出码。若只验证较新的 Node 18 小版本，同步收紧 `engines.node`。
- `REL-03`：把 exact version 发布到 `next`，不移动 `latest`。
- `REL-04`：使用 exact prerelease 完整执行官网 Prompt、TUI、headless 和 JSONL 流程，核对 registry integrity 与 package version。
- `REL-05`：把已验证的同一 exact version 提升为 `latest`，再从干净环境验证 `@latest` 解析结果、integrity 和 `woa help agent`。
- `REL-06`：只有 `@latest` smoke 通过后才部署公开首页；反向顺序禁止。
- `REL-07`：生产 smoke 记录当次受控出口 IP、白名单 token probe、脱敏 grant、requestId 和 mediaId；只创建测试草稿，不发布。

## 11. 发布门禁

以下任一条件成立即停止上线：

- `npx ... @latest woa help agent` 不存在或需要联网下载第二份 Skill。
- Agent Help 包含客户端专属分支、静态 Bearer、完整 callback URL 回传或 `--app-secret` 示例。
- AppSecret 可出现在 argv、Agent transcript、日志或本地配置。
- TUI 显示、缓存或重绘 OAuth token、authorization code、PKCE verifier、AppSecret 或完整 callback URL。
- 官网、前端或 Agent Help 硬编码 relay IP，或者 init 返回的 IP 与生产 relay 实际出口不一致。
- 用户只勾选“已加入白名单”就被标为完成，尚未经过 relay 的微信 token probe。
- 未授权 `/mcp` 不能被受支持宿主自动发现 OAuth metadata。
- CLI 登录或 CLI probe 会把宿主 MCP 状态误标为完成。
- 宿主不能自动刷新 token，却仍被页面或 Agent 声称受支持。
- 测试草稿没有明确用户确认、可能 publish，或相同 run 会重复创建。
- Node 18 基线因 TUI 依赖失效，或者 `npm pack` 产物缺少 TUI 运行文件。
- 输出出现 alternate-screen/清屏序列，或已完成步骤未保留在 scrollback。
- pipe/CI/Agent 模式会等待按键，任一 JSONL 行不可解析，或 stdout 出现 ANSI、spinner、光标控制符、提示文案等非 contract 内容。
- `--plain` 不能完成同一流程，或暂停/信号退出后的终端恢复、原子 checkpoint、exact-version structured resume 任一失败。
- 公开首页仍要求登录、轮询连接状态、展示客户端 tabs 或让用户理解 tenant/grant/token。

## 12. REVIEW → DESIGN 结论

### REVIEW

该方案比旧 `/setup` 向导删除了页面状态机、轮询 API、客户端选择器、首次完成 telemetry 和独立 Skill 发布链。当前 CLI 仍要求用户在零散命令、原始 JSON 和浏览器 handoff 之间自行判断进度；渐进式 TUI 用一个当前动作、可验证事实和恢复命令弥合这段执行与评估缺口。剩余复杂度集中在真正不能省略的地方：OAuth 标准兼容、秘密不经过 Agent、宿主与 CLI grant 分离、跨租户 fail-closed，以及测试草稿的用户确认和幂等。

### DESIGN

主任务只有一个：把最新、可信的接入任务交给 Agent。页面层级因此收敛为 H1、业务说明、Prompt、一个按钮和安全提示。所有动态流程、错误恢复和版本差异都下沉到 CLI 内置 Help、`woa init` 与结构化 init 事件。人类直接运行时看到保留滚屏历史的渐进式 TUI；Agent 和非交互环境消费同一状态机的 JSONL/纯文本输出，不需要第二套流程。

最终体验不是“用户完成很多配置后才能离开”，而是“用户复制一次后即可关闭网站，只在 Agent 明确暂停时完成四次安全动作：登录授权、微信 IP 白名单、秘密输入和测试草稿确认”。

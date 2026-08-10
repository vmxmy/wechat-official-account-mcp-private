# 别再让 Agent「口头 review」了：把阿里 Open Code Review 装进你的 coding 流水线

> 系列：**Agent Coding 工具与技巧** · 第 1 期 · Open Code Review（`ocr`）

---

## ① 一张卡 · Summary

| 字段 | 内容 |
|------|------|
| **工具** | Open Code Review（OCR） |
| **项目地址** | https://github.com/alibaba/open-code-review |
| **官网** | https://open-codereview.ai |
| **文档站** | https://alibaba.github.io/open-code-review/ |
| **npm** | https://www.npmjs.com/package/@alibaba-group/open-code-review |
| **出品** | 阿里开源 · 前身是集团内部 AI CR 助手 |
| **是什么** | 读 Git diff / 扫全文件的 **AI 代码审查 CLI**，输出**行级**意见 |
| **不是什么** | 不是 GitHub App 类 SaaS（CodeRabbit 那一路）；不是让 Claude 口头说「看起来不错」 |
| **核心设计** | **确定性工程 × LLM Agent**：选文件、打包、行号、规则路由用工程；读上下文、判问题用 Agent |
| **为什么值得装** | 通用 Agent 做 CR 常见三痛：漏文件、行号飘、质量看心情；OCR 用硬约束压噪声 |
| **官方口径** | 同模型下 Precision / F1 更高，token 约 **1/9**，Recall 有意让路给精准（低噪声优先） |
| **装法** | `npm i -g @alibaba-group/open-code-review` → 配置 LLM → `ocr review` |
| **Agent 接入** | 官方 Skill + `--audience agent`；也支持 Claude Code / Codex / Cursor |
| **许可** | Apache-2.0 · 自管模型端点 · 数据可不出内网 |
| **仓库热度** | GitHub `alibaba/open-code-review` · 约 **1.0 万+ star**（2026-07 查询） |
| **一句话** | **让 Agent 写代码，让 OCR 专岗审代码——分工比「又让同一个 Agent 自夸」靠谱。** |

---

## ② 复制即用 · 给 Agent 的安装到配置完成 Prompt

下面整段可直接粘贴给 Claude Code / Codex / Cursor / 任意 coding agent。  
**只改尖括号里的占位符**，不要把真实 Key 写进仓库或聊天记录截图。

````markdown
# 任务：在本机从零安装并配置 Alibaba Open Code Review（ocr），直到 `ocr llm test` 通过

你是运维向的 coding agent。按顺序执行，每步验证后再进入下一步。不要跳过检查。不要把 API Key 写入 git 跟踪文件或提交。

## 项目与文档（以官方为准，配置前先打开核对）
- **GitHub 主仓库**：https://github.com/alibaba/open-code-review
- **官网**：https://open-codereview.ai
- **文档站**：https://alibaba.github.io/open-code-review/
- **npm 包**：https://www.npmjs.com/package/@alibaba-group/open-code-review
- **官方 Skill**：https://github.com/alibaba/open-code-review/tree/main/skills/open-code-review
- **中文 README**：https://github.com/alibaba/open-code-review/blob/main/README.zh-CN.md
- **安装脚本（macOS/Linux）**：https://raw.githubusercontent.com/alibaba/open-code-review/main/install.sh
- 安装/配置命令若与本文不一致，**以仓库最新 README 为准**。

## 目标验收（全部满足才算完成）
1. `which ocr` 能找到命令
2. `ocr version`（或 `ocr --version`）能打印版本
3. LLM 已配置（provider 或 env）
4. `ocr llm test` 成功
5. 在当前 git 仓库跑一次：`ocr review --preview`，能列出待审文件（无 LLM 也可预览）
6. 最后用中文向我汇报：项目地址、版本号、provider/model、配置文件路径、三条常用命令、注意事项

## 前置
- 需要 Node.js / npm（推荐 npm 全局安装）
- 需要 Git ≥ 2.41
- 用户会提供 LLM：要么给 API Key，要么已有环境变量
- 若用户未提供 Key：停下来索要，**禁止伪造 Key**
- 不确定 flag/配置项时：优先查阅 https://github.com/alibaba/open-code-review 的 README

## Step 1 — 安装 CLI
优先：
```bash
npm install -g @alibaba-group/open-code-review
```
验证：
```bash
which ocr
ocr version || ocr --version
```
若 npm 不可用，macOS/Linux 备选（先下载脚本审阅再执行更安全）：
```bash
curl -fsSL https://raw.githubusercontent.com/alibaba/open-code-review/main/install.sh -o /tmp/ocr-install.sh
# 审阅后：
sh /tmp/ocr-install.sh
```

## Step 2 — 配置 LLM（二选一，优先 A 交互 / B 非交互）

### A. 交互（本机有人盯着终端时）
```bash
ocr config provider
ocr config model
ocr llm test
```

### B. 非交互 / CI / 自定义网关（OpenAI 兼容）
把占位符换成真实值后执行（示例：自定义网关）：
```bash
ocr config set provider <PROVIDER_NAME>
ocr config set custom_providers.<PROVIDER_NAME>.url <BASE_URL>
ocr config set custom_providers.<PROVIDER_NAME>.protocol openai
ocr config set custom_providers.<PROVIDER_NAME>.api_key <API_KEY>
ocr config set custom_providers.<PROVIDER_NAME>.model <MODEL_NAME>
ocr llm test
```

### 内置 Anthropic 示例
```bash
ocr config set provider anthropic
ocr config set providers.anthropic.api_key <API_KEY>
ocr config set providers.anthropic.model claude-sonnet-4-6
ocr llm test
```

### 环境变量（优先级最高，适合 CI，不必写配置文件）
```bash
export OCR_LLM_URL=<URL>
export OCR_LLM_TOKEN=<API_KEY>
export OCR_LLM_MODEL=<MODEL>
# Anthropic 消息协议时：
export OCR_USE_ANTHROPIC=true
ocr llm test
```

配置文件默认位置：`~/.opencodereview/config.json`（勿提交到 git）

## Step 3 — 安装 Agent Skill（可选但推荐）
若用户使用支持 Agent Skills 的环境，安装官方 skill（来源同上项目仓库）：
- **Skill 目录**：https://github.com/alibaba/open-code-review/tree/main/skills/open-code-review
- 或将 skill 放到用户 skills 目录（如 `~/.agents/skills/open-code-review/`）
Skill 约定：review 时用 `--audience agent`，并尽量传 `-b/--background` 业务上下文。

## Step 4 — 冒烟审查
在**当前 git 仓库根目录**：
```bash
# 先看会审哪些文件（不花 token）
ocr review --preview

# 工作区变更审查（staged + unstaged + untracked）
ocr review --audience agent --background "简要说明这次改动的业务目的"

# 分支对比
ocr review --audience agent --from main --to HEAD --background "PR 目标：..."

# 单 commit
ocr review --audience agent --commit HEAD --background "..."
```

## Step 5 — 项目规则（可选）
若用户需要项目定制规则，创建：
`<repo>/.opencodereview/rule.json`
示例结构：
```json
{
  "rules": [
    {
      "path": "**/*.{ts,tsx,js}",
      "rule": "Validate external input at boundaries; no empty catch; no secrets in logs",
      "merge_system_rule": true
    }
  ]
}
```
检查某文件命中规则：
```bash
ocr rules check path/to/file.ts
```

## 约束
- 不要在对话中回显完整 API Key
- 不要 commit `~/.opencodereview/config.json`
- 大 diff 可降并发：`--concurrency 2`，或先 `--preview`
- Agent 输出模式必须 `--audience agent`（避免进度条污染）
- 用户只说「review」时：只报告问题；用户说「review and fix」才改代码

## 交付给我的报告模板
- 项目地址：https://github.com/alibaba/open-code-review
- OCR 版本：
- 安装路径：
- Provider / Model：
- `ocr llm test`：通过 / 失败原因
- `ocr review --preview` 样例输出摘要：
- 三条我以后可复制的命令：
- 风险与坑：
````

**给人类的最短口令（不调 Agent 时自己敲）：**

```bash
npm i -g @alibaba-group/open-code-review
ocr config provider && ocr config model
ocr llm test
cd your-repo && ocr review --audience agent -b "这次改动在干什么"
```

---

## ③ 详细介绍

### 1. 你真正需要的不是「更会说话的 Agent」，而是「专岗」

Agent coding 普及之后，很多人的 CR 流程变成了：

1. 让 Agent 写完  
2. 再问同一只 Agent：「帮我 review 一下」  
3. 得到一段很客气、经常**漏文件、指错行、假阳性一堆**的长文  

这不是模型不够聪明，是**形态不对**。

通用 Agent 擅长：探索仓库、改代码、跑命令。  
代码审查真正难的几件事，反而是「不能靠感觉」的：

- 这次 diff **到底有哪些文件**必须看完  
- 意见必须**钉在正确的文件与行号**  
- 规则要**可复现**，不能 prompt 改两个词质量就塌  

阿里把内部用了约两年的 AI 审查助手开源成 **Open Code Review**，CLI 名 **`ocr`**。公开叙事是：服务过数万开发者、识别过数百万缺陷，再以 Apache-2.0 放出来。你要做的不是再写一个 review skill 散文，而是**把审查从「聊天」降成「命令」**。

---

### 2. OCR 解决的三件事（对应通用 Agent 的三坑）

官方 README 把痛点写得很直白：

| 通用 Agent + 自然语言 Skill | OCR 的做法 |
|----------------------------|------------|
| 大变更时偷懒、漏文件 | **工程侧文件筛选**，该审的进队列 |
| 问题定位漂移（行号/文件对不上） | **外挂定位 + 反思模块**，行级评论 |
| 质量随 prompt 抖动 | **规则模板匹配 + 场景化工具集**，减少「纯靠说话」 |

一句话：**确定性工程负责「别搞砸流程」，Agent 负责「判断与上下文」。**

这叫 **Hybrid（混合架构）**——不是「全盘 agentic 自由发挥」，也不是「纯静态规则扫一遍就完」。

---

### 3. 它在你流水线里的位置

```text
你 / Agent 写代码
        │
        ▼
   git diff / 分支 / commit
        │
        ▼
   ocr review / ocr scan     ← 专岗审查（可接任意 LLM）
        │
        ▼
   行级意见（text / json）
        │
        ├── 人读完改
        ├── Agent 按 High/Medium 修
        └── CI 门禁 / 留 session
```

和 CodeRabbit、Greptile、Copilot Code Review 的差别，不在「谁更神」，而在**部署形态**：

| 维度 | OCR | 典型 PR SaaS |
|------|-----|----------------|
| 形态 | 本地 / CI CLI | GitHub App 云审 |
| 模型 | 你自己的端点（含私有网关） | 多为厂商托管 |
| 数据 | 可完全内网 | 代码常出网 |
| 接入 Agent | Skill + `--audience agent` | 评论回 PR |
| 全仓无 diff | `ocr scan` | 偏 PR 场景 |

**Agent coding 工作站**更适合 OCR：你已经有 Claude/Codex 在改仓库，审查应是**同机一条命令**，而不是再绑一个云应用才能说话。

---

### 4. 命令地图（够日常就够）

| 场景 | 命令 |
|------|------|
| 工作区改了什么就审什么 | `ocr review` |
| 只预览文件清单（省钱） | `ocr review --preview` |
| PR / 分支 | `ocr review --from main --to feature` |
| 单个提交 | `ocr review --commit <sha>` |
| 给 Agent 干净输出 | `ocr review --audience agent` |
| 带业务背景（强烈建议） | `ocr review -b "登录接口加限流"` 或 `-B ./docs/req.md` |
| 无 diff 审计陌生目录 | `ocr scan --path src/` |
| 测模型连通 | `ocr llm test` |
| 查文件命中哪条规则 | `ocr rules check path/to/file.go` |
| 会话复盘 | `ocr session list` / `ocr viewer` |

**Background 不是装饰。**  
同一段 diff，「加限流」和「重构命名」该盯的风险完全不同。`-b` / `-B` 就是把业务意图塞进审查上下文——这也是官方 skill 强制要求 agent 做的一步。

---

### 5. 规则：内置 + 仓库级，比「再写一段 system prompt」稳

OCR 自带面向缺陷类型的规则资产（公开材料常举 NPE、线程安全、XSS、SQL 注入等），并支持项目覆盖。

解析优先级（skill 文档口径）：

1. `--rule <path>`  
2. `<repo>/.opencodereview/rule.json`  
3. `~/.opencodereview/rule.json`  
4. 内置默认  

`merge_system_rule: true` 时，可以「系统规则 + 你的规则」一起上，而不是一刀切替换。

对团队：把**语言约定、安全边界、禁止模式**写进 `rule.json`，比写在某个同事的 Claude memory 里可迁移得多。

---

### 6. 和「Agent 自己 review」怎么分工（可执行约定）

推荐默认纪律：

1. **写代码的 Agent** 不负责最终签字  
2. **OCR** 出 High / Medium / Low；Low 可丢（噪声）  
3. 用户说「review」→ 只报告；说「review and fix」→ 才改  
4. 大 diff：先 `--preview`，再降 `--concurrency`，必要时拆 commit  
5. CI 用 env 注 Key，本机用 `~/.opencodereview/config.json`，**永不进仓库**

这和「一个 Agent 写完再自我表扬」的差别是：**工具链有第二意见，且第二意见的流程是工程化的。**

---

### 7. 基准与预期（读官方数字时的正确姿势）

官方 benchmark 叙事（README）：

- **50** 仓 · **200** 真实 PR · **10** 语言  
- **80+** 资深工程师交叉标注 · **1505** 个 ground-truth issues  
- 相对通用 Agent（同底模）：**更高 Precision / F1**，token 约 **1/9**，更快  
- **Recall 更低是刻意取舍**：宁可少报、少噪音，也不要刷屏误报  

所以你不要期待 OCR「找出宇宙中所有 bug」。  
你该期待的是：**意见更可行动、更少废话、更便宜。**  
漏报要靠测试、SAST、人工、第二轮 `ocr scan` 补，而不是幻想一个 CLI 包办质量。

---

### 8. 进阶：CI、delegate、Skill

**CI 思路**

```bash
npm i -g @alibaba-group/open-code-review
export OCR_LLM_URL=...
export OCR_LLM_TOKEN=...
export OCR_LLM_MODEL=...
ocr review --from "$BASE_SHA" --to "$HEAD_SHA" --format json --audience agent -b "$PR_TITLE"
```

JSON 便于你自己写门禁（例如 High > 0 则 fail）。具体门禁策略因团队而异，官方不替你做「合并策略」。

**`ocr delegate`**  
输出审查规格 / 规则给宿主 Agent，**自己不调 LLM**——适合「宿主模型很强、只想要 OCR 的文件选择与规则路由」的拼装。

**Skill**  
仓库自带 `skills/open-code-review`，把「何时跑、如何传 background、如何分级汇报」固化进 agent 行为。支持矩阵上 README 标了 Claude Code / Codex / Cursor。

---

### 9. 踩坑清单（装完不骂街版）

| 坑 | 处理 |
|----|------|
| 没配 LLM 就 `ocr review` | 先 `ocr config provider` 或 env，再 `ocr llm test` |
| Git 太旧 | 升到 ≥ 2.41 |
| 把 config 提交进仓库 | `.gitignore`；Key 只放本机或 CI secret |
| 大 diff 超时 / 限流 | `--concurrency 2`、`--timeout`、拆 PR |
| Agent 输出一堆进度条 | 永远 `--audience agent` |
| 行号为 0 | 定位失败；按 comment 内容回文件里人工对齐（skill 有说明） |
| 中英文评论 | 配置 `language`（默认中文，可 English） |
| 以为能替代测试 | 不能；OCR 是审查层，不是测试层 |

---

### 10. 什么时候别用 OCR 硬刚

- 你只需要「PR 上自动盖楼、零本地运维」→ SaaS 更省心  
- 你要的是全量安全合规扫描 → 上 Semgrep / Sonar 等，OCR 是补充不是替代  
- 仓库不是 git、或 Git 版本过旧 → 先修环境  
- 没有可用模型预算 → CLI 再强也审不动  

---

### 11. 本期可转存清单

**最小闭环（今天就能做）**

1. `npm i -g @alibaba-group/open-code-review`  
2. `ocr config provider` → `ocr llm test`  
3. 当前项目：`ocr review --audience agent -b "一句话业务目的"`  
4. 把官方 skill 丢进你的 agent skills 目录  
5. （可选）仓库加 `.opencodereview/rule.json`  

**团队级**

1. CI 里对 PR diff 跑 `ocr review --format json`  
2. 规则文件进主仓，和 lint 一样 review  
3. 约定：合并前必须有一轮 OCR 或等价专岗审查  

**Agent 纪律**

1. 写代码 Agent ≠ 最终 reviewer  
2. 有 background 再审  
3. 先 preview 再烧 token  

---

### 12. 站队结尾

Agent coding 的分水岭，不是谁 prompt 写得更像领导讲话，而是**谁肯把「审查」从聊天里拆出来，变成可安装、可配置、可 CI 的工具**。

Open Code Review 不神秘：阿里内部打磨过的 **hybrid CR CLI**，开源给你用自己的模型审自己的 diff。

你可以继续让同一个 Agent 写完再自夸。  
也可以花 10 分钟装好 `ocr`，让第二意见变成默认。

**下一期若继续「Agent Coding 工具与技巧」系列，可以写：OCR × CI 门禁模板，或「rule.json 怎么写才不变成第二套 lint 废话」。你更想先看哪篇，评论区回一个字：`CI` 或 `规则`。**

---

## ④ 信息来源

以下为撰写时核对过的一手/准一手来源；star 数与版本会变动，以页面实时为准。

| 来源 | 用途 | 链接 |
|------|------|------|
| 官方 GitHub 仓库 README（中/英） | 产品定义、架构、安装、配置、benchmark 表述 | https://github.com/alibaba/open-code-review |
| 中文 README | 中文口径与痛点描述 | https://github.com/alibaba/open-code-review/blob/main/README.zh-CN.md |
| 官方网站 | 产品页 | https://open-codereview.ai |
| 文档站 | Agent Native Code Review 说明 | https://alibaba.github.io/open-code-review/ |
| npm 包 | 安装包名与版本 | https://www.npmjs.com/package/@alibaba-group/open-code-review |
| 官方 Skill | Agent 调用约定（`--audience agent`、background、规则优先级） | https://github.com/alibaba/open-code-review/tree/main/skills/open-code-review |
| GitHub 元数据（查询日约 2026-07-21） | 描述、license Apache-2.0、star/fork 量级 | `gh api repos/alibaba/open-code-review` |
| Hacker News 讨论 | 开源动机与社区反馈 | https://news.ycombinator.com/item?id=48406358 |
| 本机 CLI 实测 | 命令面：`review` / `scan` / `delegate` / `rules` / `llm` / `session` / `viewer`；版本样例 open-code-review v1.7.x | 本地 `ocr --version`、`ocr review -h` 等 |

**写作边界说明**

- 文中「数百万缺陷 / 数万开发者 / 约 1/9 token」等为**官方 README 公开表述**，非本文独立测评。  
- 未宣称 OCR 全面碾压 CodeRabbit 等 SaaS；对比仅限**形态与适用场景**。  
- 安装与配置命令以官方文档为准；若上游改 flag，以仓库最新 README 覆盖本文。

---

## 元信息（编辑用，可不发）

| 项 | 内容 |
|----|------|
| 平台 | 公众号 / 技术 Newsletter 均可 |
| 定位 | 实用干货（Agent Coding 工具与技巧系列） |
| 结构 | 卡摘要 → 可复制 Agent Prompt → 详解 → 来源 |
| 预估阅读 | 8–12 分钟 |
| 封面建议 | 大字「OCR」+ 小字「Agent 写 · 专岗审」；或 CLI 终端截图风格 |
| 预览摘要 | 通用 Agent 口头 review 会漏文件、飘行号；阿里开源 OCR 用混合架构专岗审代码，文内附安装到配置完成的一键 Prompt。 |

### 标题备选

1. **别再让 Agent「口头 review」了：阿里 OCR 安装到配置一篇搞定**（推荐）  
2. Agent 写代码谁来审？把 Open Code Review 嵌进你的流水线  
3. 复制这段 Prompt，让 Agent 自己装好阿里开源代码审查  
4. 通用 Agent 审代码的三坑，和 OCR 怎么拆  
5. Open Code Review 实操：一张卡 + 一条 Prompt + 可转存清单  

### 金句包

- 让 Agent 写代码，让 OCR 专岗审代码。  
- 审查要从「聊天」降成「命令」。  
- 确定性工程负责别搞砸流程，Agent 负责判断。  
- 你需要的不是更会说话的 reviewer，是更稳的第二意见。  
- Recall 让路给 Precision：少报废话，比刷屏有用。  

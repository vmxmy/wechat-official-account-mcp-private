# 前端 Skills 只跟这两条新：Impeccable 去 AI 脸，Vercel 教你做原生转场

> 系列：**Agent Coding 工具与技巧** · 第 2 期 · 前端设计 + 动效  
> 承接上期：榜上常提的 `frontend-design` / `react-best-practices` 热但不新；本篇只写 **2026-07 仍在猛更** 的两条。

---

## ① 一张卡 · Summary

| 字段 | 内容 |
|------|------|
| **本期两件** | ① Impeccable（设计）② Vercel `react-view-transitions`（动效/转场） |
| **为什么是这两条** | 官方/高星前端 skill 里，**最近 48h 仍有实质提交**的代表各一条：设计向 + 工程向 |
| **项目地址 · Impeccable** | https://github.com/pbakaus/impeccable |
| **官网 · Impeccable** | https://impeccable.style |
| **项目地址 · Vercel Skills** | https://github.com/vercel-labs/agent-skills |
| **本 skill 路径 · VT** | https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions |
| **Skills 目录页** | https://skills.sh/vercel-labs/agent-skills |
| **更新信号（约 2026-07-21）** | Impeccable：仓 **当天** 仍 push；VT：仓 **7/20** 合并多条 view-transition 规则学习 |
| **不是什么** | 不是再安 128 个 UI skill；不是替代 `react-best-practices` 性能包；不是教你写 Framer 广告片 |
| **分工** | **Impeccable**：让界面不像 AI 默认脸（brand/product 分流 + 23 命令 + 反 slop） |
| | **react-view-transitions**：用浏览器原生 View Transition + React `<ViewTransition>`，页面/列表/共享元素「有空间关系」地动 |
| **和榜一榜四的关系** | Anthropic `frontend-design` 路径约 **6/9** 才改；Vercel `react-best-practices` 约 **4 月**；热 ≠ 新 |
| **装法一句话** | Impeccable：`npx impeccable install` → `/impeccable init`；VT：从 vercel-labs/agent-skills 装 `react-view-transitions` |
| **Agent 适配** | Claude Code / Codex / Cursor 等支持 Agent Skills 的客户端 |
| **一句话** | **设计 skill 管「长什么样」；VT skill 管「状态怎么换」——两条新线，别混成一锅美化。** |

---

## ② 复制即用 · 给 Agent 的安装到配置完成 Prompt

下面整段可直接粘贴给 Claude Code / Codex / Cursor / 任意 coding agent。  
**只改尖括号占位符**；不要把 API Key 写进仓库。

````markdown
# 任务：在本机/当前项目安装并验收两个前端 Skill
# 1) pbakaus/impeccable（设计）
# 2) vercel-labs/agent-skills 的 react-view-transitions（原生转场）
# 直到能触发 skill、并各跑一次最小验收。

你是运维向的 coding agent。按顺序执行，每步验证后再下一步。不要跳过检查。

## 项目与文档（以官方为准）

### A. Impeccable
- **GitHub**：https://github.com/pbakaus/impeccable
- **官网 / 文档**：https://impeccable.style
- **Skill 路径（仓内）**：`.agents/skills/impeccable/SKILL.md`
- **推荐安装**：在**用户项目根目录**执行 CLI（见下）
- 命令与参考文件以仓库最新 README / SKILL.md 为准

### B. Vercel Agent Skills · react-view-transitions
- **GitHub 仓**：https://github.com/vercel-labs/agent-skills
- **本 skill 目录**：https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions
- **技能目录页**：https://skills.sh/vercel-labs/agent-skills
- **协议**：MIT（见 skill frontmatter）
- 同仓还有 `react-best-practices`、`web-design-guidelines` 等；**本次只装/验收 VT**，除非用户要求一起装

## 目标验收（全部满足才算完成）
1. Impeccable 已装到当前项目（或用户全局 skills 约定位置），存在可调用入口（如 `/impeccable` 或 skill 描述可被 agent 匹配）
2. 项目中能找到 PRODUCT.md 流程说明：要么已执行 init，要么明确报告「缺 PRODUCT.md 时 scoped 请求不阻塞」的策略（按官方 SKILL）
3. `react-view-transitions` skill 文件在 agent 可加载路径中（SKILL.md 存在）
4. 用中文汇报：两个项目地址、安装路径、版本/commit 若可得、三条常用命令、注意事项
5. **不要**在未要求时大改业务代码；验收以「skill 可触发 + 读通工作流」为主

## 前置
- Node.js / npm 可用
- 用户项目是 git 仓库更佳（Impeccable 在项目根装）
- 若安装方式因平台不同（Claude Code plugin / Codex skills / Cursor skills）：优先官方 README；失败则查仓库 Issues 与 skills.sh
- 不确定 flag 时打开上述 GitHub 链接核对

---

## Step 1 — 安装 Impeccable

在**用户前端项目根目录**（不是 skill 仓本身）：

```bash
# 推荐：官方 CLI
npx impeccable install
```

备选：按 https://github.com/pbakaus/impeccable README 的其他安装方式（克隆 skill 到 `.agents/skills` 等）。

验证：
- 项目中出现 Impeccable skill 文件，或 agent 能识别 `impeccable` skill
- 阅读 skill 的 Commands 表（craft / shape / init / audit / polish 等）

然后（**新项目或用户明确要求建立设计上下文时**）在 agent 内触发：

```text
/impeccable init
```

或等价自然语言：「用 Impeccable init 为本项目写 PRODUCT.md / DESIGN.md」

注意（来自官方 SKILL，必须遵守）：
- 每个会话先按 skill 跑 `context.mjs`（路径以 skill 实际安装位置为准）
- **brand（营销落地页）** vs **product（后台/工具 UI）** 要分 register，禁止一套审美打天下
- 缺 PRODUCT.md 时：**scoped 改现有页面不阻塞**；from-scratch 的 craft/shape 才先 init
- 不要默认 cream/sand 背景、嵌套卡片、Inter 全家桶等 anti-patterns

## Step 2 — 安装 Vercel react-view-transitions

优先使用 skills 生态安装器（若环境支持），例如（命令以 skills.sh / 仓库 README 最新为准）：

```bash
# 示例：按 skills 标准从 vercel-labs 仓添加（若 npx skills 可用）
npx skills add vercel-labs/agent-skills --skill react-view-transitions
```

若上面命令不存在或失败，则手动：

```bash
# 稀疏检出或完整 clone 后拷贝 skill 目录
git clone --depth 1 https://github.com/vercel-labs/agent-skills.git /tmp/vercel-agent-skills
# 拷到用户 agent skills 目录之一，例如：
#   <project>/.agents/skills/react-view-transitions/
#   或 ~/.agents/skills/react-view-transitions/
cp -R /tmp/vercel-agent-skills/skills/react-view-transitions \
  <目标 skills 目录>/react-view-transitions
```

验证：
- 目标路径存在 `SKILL.md`，name 含 `vercel-react-view-transitions` 或等价
- 打开 `references/implementation.md` 与 `references/css-recipes.md` 是否存在（官方要求实现时跟这两份，别自造动画 CSS）

技术前提（写入报告）：
- **Next.js App Router**：一般**不要**另装 `react@canary`（内置 canary）
- **非 Next**：需要 `react@canary` + `react-dom@canary`（ViewTransition 不在 stable）
- 浏览器：Chromium 111+、Firefox 144+、Safari 18.2+；不支持则 graceful skip

## Step 3 — 最小冒烟（只读/小范围，除非用户说「直接改页面」）

### Impeccable 冒烟
```text
/impeccable critique <一个已有页面或组件路径>
# 或
/impeccable audit <路由或文件>
```
输出应包含可执行的设计/ a11y 问题，而不是空话。

### react-view-transitions 冒烟
仅当用户同意改代码时：
1. 读 skill 的 implementation 顺序：Shared element → Suspense reveal → List identity → enter/exit → Route
2. **不要**手写 `document.startViewTransition`；用 React `<ViewTransition>`
3. CSS 从 `css-recipes.md` 拷贝，禁止即兴弹跳动画
4. 层级导航才用 forward/back 方向滑动；Tab 横向切换不要假装「有深度」

若用户暂不同意改代码：只输出「若接入，计划改哪些文件」清单即可。

## Step 4 — 可选：同仓其他前端 skill（默认跳过）
仅当用户说「一起装 Vercel 前端全家桶」时再装：
- `react-best-practices` — 性能规则
- `web-design-guidelines` — a11y/UX 审计  
不要与 Impeccable 命令混用同一句 prompt 导致抢触发。

## 约束
- 安装命令以 GitHub 最新 README 为准，本文过时则跟仓库
- 不要提交无关格式化大 diff
- 不要把 Impeccable 的 brand 规则套到 admin dashboard（或反过来）
- VT：无空间叙事就不要加动画

## 交付给我的报告模板
- Impeccable 项目地址：https://github.com/pbakaus/impeccable
- Impeccable 安装路径 / 是否已 init：
- Vercel 仓地址：https://github.com/vercel-labs/agent-skills
- react-view-transitions 安装路径：
- 验收命令与结果：
- 三条我以后可复制的触发语：
- 风险与坑（register 混淆、React canary、动画滥用）：
````

**给人类的最短口令：**

```bash
# 1) 设计
cd your-frontend-app && npx impeccable install
# 在 agent 里：/impeccable init

# 2) 转场（把 skill 放进你的 skills 目录）
# 见 https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions
```

---

## ③ 详细介绍

### 1. 先把时间线钉死：热的不一定是新的

前端 skill 榜上常年挂着：

- Anthropic **`frontend-design`**（安装量巨大）
- Vercel **`react-best-practices`**（React/Next 性能规矩）

查官方仓库路径 commit 会发现（约 2026-07-21）：

| Skill | 路径最近实质更新 |
|-------|------------------|
| `frontend-design` | 约 **2026-06-09** |
| `react-best-practices` | 约 **2026-04-14** |
| **Impeccable 仓** | **2026-07-21 仍在 push** |
| **`react-view-transitions`** | **2026-07-20** 一串规则补丁 |

所以本篇不追「装机榜」，只追 **还在写 changelog 的两条**：  
一条管 **长相**，一条管 **状态切换怎么动**。

---

### 2. Skill ①：Impeccable —— 从「有个设计 skill」到「设计操作系统」

#### 它是谁

- 仓库：https://github.com/pbakaus/impeccable  
- 站点：https://impeccable.style  
- 作者侧定位：给 AI coding agent 的 **design guidance**  
- 公开叙事：在 Anthropic `frontend-design` 的启发上长出来，补上 **init 上下文、命令系统、确定性检测**

README 口径（摘要）：

- **1 个 skill · 23 个命令**
- 支持 live browser 迭代  
- **46 条确定性 detector**（CLI/扩展可无 LLM 跑一部分规则）

#### 它解决什么真实痛

每个模型都啃过同一批 SaaS 模板。不装约束时，你会稳定收到：

- Inter 通吃  
- 紫→蓝渐变  
- 卡片套卡片  
- 灰字铺在彩色底上  
- 每个 section 上面一条「ABOUT / PROCESS」小大写 eyebrow  

Impeccable 不靠「再写一句请更有品位」，而是：

1. **`/impeccable init`** 写下 `PRODUCT.md`（及可选 `DESIGN.md`）：观众、brand/product 车道、反参考、色与字  
2. 后续 `craft` / `critique` / `audit` / `polish`… **读同一套上下文**  
3. SKILL 里写死 **register**：营销落地页读 `brand.md`，后台工具读 `product.md`——**设计是产品本身 vs 设计服务产品**，两套语言  
4. 长长的 **anti-patterns / AI slop test**：包括 2026 年已经烂大街的 cream/sand 背景、hero-metric 模板、过度圆角 + 宽阴影的 ghost-card 等  

#### 命令怎么用（记 6 个就够开工）

| 命令 | 场景 |
|------|------|
| `/impeccable init` | 新项目或第一次接入，建上下文 |
| `/impeccable shape` | 先 UX 再写码 |
| `/impeccable craft` | 端到端做一版 |
| `/impeccable critique` | 观感/层级/情绪启发式评审 |
| `/impeccable audit` | a11y、性能、响应式技术检查 |
| `/impeccable polish` | 上线前最后一遍 |

进阶：`bolder` / `quieter` / `animate` / `harden` / `live`… 都在同一入口 `/impeccable <command>`。

#### 和 `frontend-design` 怎么选

| | Anthropic frontend-design | Impeccable |
|--|---------------------------|------------|
| 体量 | 相对轻的官方示例 skill | 命令 + 参考 + 脚本 + 检测 |
| 上下文 | 偏「通用好设计」 | **PRODUCT/DESIGN 持久化** |
| 更新 | 路径更新偏慢 | **2026-07 仍活跃** |
| 适合 | 快速去一点 slop | 认真做产品/品牌前端的 agent 工作流 |

不是互斥：很多人先有 frontend-design，再上 Impeccable 当「加强版操作系统」。  
若只能留一个设计 skill——**做交付前端，Impeccable 更像完整流程**。

---

### 3. Skill ②：Vercel `react-view-transitions` —— 动效里的「工程纪律」

#### 它是谁

- 仓：https://github.com/vercel-labs/agent-skills  
- 路径：`skills/react-view-transitions`  
- skill name：`vercel-react-view-transitions`  
- 元数据：author **vercel**，MIT，version 1.0.0（以 frontmatter 为准）  
- 触发域：页面转场、路由动画、共享元素、列表重排、进退场、Next 集成、`startViewTransition` / `ViewTransition` 相关问题  

#### 它解决什么

Agent 一听「加动画」就容易：

- 乱上 Framer / 乱写 bounce  
- 每个 Tab 都侧滑，假装有信息架构深度  
- 手写 `document.startViewTransition`，和 React 调度打架  

这个 skill 把规矩写成 **可执行清单**：

1. **每个 `<ViewTransition>` 必须能说清空间关系**；说不清就不要加  
2. 实现顺序（有用就全做，不是四选一）：  
   Shared element → Suspense reveal → List identity → enter/exit → Route change  
3. **层级导航**才用 `nav-forward` / `nav-back` 方向滑动；**Tab 横向**用淡入或 `default="none"`  
4. 只用 `startTransition` / `useDeferredValue` / `Suspense` 触发；普通 `setState` 不动画  
5. **不要自己调** `startViewTransition`；用 React `<ViewTransition>`  
6. CSS **从 `references/css-recipes.md` 拷**，跟 `implementation.md` 走审计步骤，禁止即兴动画 CSS  

#### 版本与浏览器（写进团队 wiki 的那种）

| 环境 | 注意 |
|------|------|
| Next.js App Router | **不要**为了 VT 再装 `react@canary`（内置） |
| 非 Next | 需要 `react@canary` + `react-dom@canary` |
| 浏览器 | Chromium 111+、Firefox 144+、Safari 18.2+；不支持则跳过动画 |

#### 和「装个 motion 库 skill」的差别

| | 通用「让页面动起来」 | react-view-transitions |
|--|----------------------|-------------------------|
| 叙事 | 好看、酷 | **连续性与空间** |
| 默认依赖 | 常引第三方 | **浏览器原生 VT** |
| 失败模式 | 处处弹跳 | 不支持就 graceful skip |
| 更新信号 | 看作者心情 | Vercel 官方仓 **7/20 仍在改 VT 文档**（shared morph、tab indicator 等） |

---

### 4. 两条怎么组进同一条前端流水线

```text
需求 / 设计意图
    │
    ▼
Impeccable：init → shape/craft → critique/audit → polish
    │         （长什么样、信息架构、反 slop、a11y）
    ▼
功能实现（你的 React/Next 代码）
    │
    ▼
react-view-transitions：按 implementation 审计 → 加 VT → css-recipes
    │         （状态怎么换、有没有空间叙事）
    ▼
浏览器真机点一遍（agent-browser / Playwright 可选）
```

**纪律：**

- 同一句 prompt 不要同时 `@` 五个设计 skill，触发会糊  
- Impeccable 的 `animate` 是「有目的的动效」；**路由级共享元素**优先交给 VT skill  
- 性能与 waterfall 仍交给 **`react-best-practices`**（旧但硬），别指望 VT skill 替你消 waterfall  

---

### 5. 可转存清单

**今天 30 分钟**

1. 在业务前端根目录：`npx impeccable install`  
2. Agent：`/impeccable init`（分清 brand / product）  
3. 装入 `react-view-transitions` skill  
4. 打开 VT 的 `implementation.md`，对自己 app 勾选 5 类 pattern 哪些适用  

**本周**

1. 对一个真实落地页：`critique` + `audit`  
2. 对一个 list→detail：加 shared element + forward/back  
3. Tab 页：**删掉**错误的方向滑动  

**团队约定**

1. 新页面 PR 描述写 register：brand 还是 product  
2. 动画 PR 必须写「沟通了什么空间关系」；写不出就 revert  
3. 设计 skill 与 VT skill 分人/分 PR 也可，但流水线顺序固定  

---

### 6. 踩坑

| 坑 | 处理 |
|----|------|
| Impeccable 没 init 就 craft 全新站 | from-scratch 先 init；改旧页可不阻塞 |
| dashboard 用了 landing 的 brand 炫技 | 读错 register；强制 product.md |
| 为 VT 在 Next 里强装 canary | 按 skill：App Router 通常不必 |
| 所有导航都 slide | 只有层级/有序序列才方向滑动 |
| 外面包一层 div 再包 ViewTransition | enter/exit 被抑制；VT 要在 DOM 节点之前 |
| 仓库 `pushed_at` 很新就以为 skill 正文新了 | 像 taste-skill：可能只是 README/赞助；看 **SKILL.md 路径 commit** |

---

### 7. 站队结尾

前端 Agent 的分水岭，已经不是「会不会生成 JSX」，而是：

- 有没有 **持久的设计上下文**（而不是每聊一轮重新审美）  
- 动效是不是 **有信息结构的转场**（而不是装饰性抽搐）  

Impeccable 和 `react-view-transitions`，正好钉在这两个钉子上，而且——查官方仓——它们还在被作者/团队继续改。

榜上的旧网红 skill 可以留着当底噪过滤器。  
**真正值得你这周 `git pull` 的，是这两条还在动的线。**

**评论区回一个：你更先装 `设计` 还是 `转场`？** 下期可以按票数写实战改一个开源 landing / dashboard 对照。

---

## ④ 信息来源

| 来源 | 用途 | 链接 |
|------|------|------|
| Impeccable 仓库 | 安装、命令、定位、反 slop 叙事 | https://github.com/pbakaus/impeccable |
| Impeccable 官网 | 文档与案例 | https://impeccable.style |
| Impeccable SKILL.md（仓内） | Setup、register、Commands、设计硬规则 | `.agents/skills/impeccable/SKILL.md` |
| Vercel Agent Skills 仓 | 官方 skill 集合 README | https://github.com/vercel-labs/agent-skills |
| react-view-transitions SKILL.md | 模式优先级、触发条件、Next/canary、CSS 纪律 | https://github.com/vercel-labs/agent-skills/tree/main/skills/react-view-transitions |
| skills.sh 目录 | 发现/安装入口 | https://skills.sh/vercel-labs/agent-skills |
| Anthropic frontend-design | 对照「热但更新慢」 | https://github.com/anthropics/skills/tree/main/skills/frontend-design |
| GitHub API 元数据（约 2026-07-21） | `pushed_at`、路径 commits（Impeccable 当天；VT 7/20；frontend-design 6/9；react-best-practices 约 4 月） | `gh api repos/...` |

**写作边界**

- 「最新」指 **仓库/路径最近 commit**，不是装机榜。  
- 版本号（如 Impeccable skill `3.9.1`、VT `1.0.0`）以你克隆时 frontmatter 为准。  
- 安装 CLI（`npx impeccable install` / `npx skills add ...`）若上游变更，以 README 为准。  
- 未做独立 UI 测评；命令与规则摘自公开 README/SKILL。

---

## 元信息（编辑用，可不发）

| 项 | 内容 |
|----|------|
| 平台 | 公众号 |
| 定位 | 实用干货 · Agent Coding 工具与技巧 #2 |
| 结构 | 卡摘要 → 可复制 Agent Prompt → 详解 → 来源 |
| 预估阅读 | 9–12 分钟 |
| 封面建议 | 左「去 AI 脸」右「原生转场」；或双 skill 名大字 + 2.35:1 |
| 预览摘要 | 前端 skill 别只盯装机榜。Impeccable 当天还在更，Vercel 转场 skill 7/20 刚补规则；一文附安装到验收 Prompt。 |

### 标题备选

1. **前端 Skills 只跟这两条新：Impeccable 去 AI 脸，Vercel 教你原生转场**（推荐）  
2. 装机榜是旧网红：真正还在更新的前端 Skill 只有这两类  
3. 复制这段 Prompt，装好设计系统 skill + React View Transition skill  
4. 设计 skill 管长相，VT skill 管怎么换页  
5. 从 frontend-design 到 Impeccable：前端 Agent 的设计操作系统  

### 金句包

- 热的不一定是新的；新的才值得这周 pull。  
- 设计 skill 管长什么样，VT skill 管状态怎么换。  
- 说不清空间关系，就不要加动画。  
- cream 背景不是高级，是 2026 的 AI 默认脸。  
- 同一句 prompt 不要塞五个美化 skill。  

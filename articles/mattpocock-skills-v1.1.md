# 别再让 Agent 自己答自己：Matt Pocock Skills v1.1 把「工程闭环」补齐了

> 175k Star 的不是提示词合集，而是一套可组合、可改写的**真实工程纪律**。v1.1 把「跨会话规划、验收闸门、评审与研究」补进主链路——Twitter 上说得最狠的一句是：它把资深工程师的潜意识流程写进了 Agent。

---

## 为什么这篇值得读

如果你还在用「一句话甩需求 → 等 Agent 吐一坨代码 → 再骂它不懂」，那你和半年前的 vibe coding 没有本质区别。

**Total TypeScript / AI Hero 作者 Matt Pocock** 把自己日常 `.claude` 目录里的实战 skill 开源了：仓库 [mattpocock/skills](https://github.com/mattpocock/skills)。截至 2026 年 7 月，仓库已约 **17.5 万 Star**；最新正式版 **v1.1.0**（2026-07-08）把主流程从「会问会写」推到「能跨会话规划、能验收、能评审、能并行拆票」。

Twitter/X 上的共识很清晰：

- 热度侧：有榜单数据显示单日星标仍在 +1.9k 量级；Matt 本人也提过仓库一度 **16 万 Star + 750 万次下载** 却几乎没有教程，于是补了端到端 walkthrough；
- **@venzeti**：这是 *documentation of patterns every senior dev uses unconsciously*——把资深工程师「下意识就会做」的模式写成可安装流程；
- 定位金句来自 Matt 本人：**Superpowers gives the agent superpowers；My skills give *you* superpowers**——给 Agent 加能力 vs 给你加能力，是两套产品哲学；
- 国内开发者已开始 fork 优化（例如基于 grilling 的深度追问、runtime 提问接口），说明生态在「二次工程化」。

本文不写「又一个 skill 列表」。我们只拆 **v1.1 真正补上的闭环**，并把 Twitter 上已经验证过的**可抄实操**写进正文。

---

## 它解决的四个失败模式

Matt 自己把动机写得很直白——不是造另一个 GSD / BMAD / Spec-Kit 来「接管你的流程」，而是用**小、可改、可组合**的 skill 修 Agent 的常见翻车：

| 失败模式 | 典型症状 | 主修 skill |
|---------|---------|-----------|
| 没做你想要的 | 需求模糊，做完才发现完全偏航 | `/grill-me`、`/grill-with-docs` |
| 话太多 | 项目术语不统一，Agent 用 20 个词说 1 件事 | 共享语言 `CONTEXT.md` + domain-modeling |
| 代码不可靠 | 没有反馈环，绿测假绿 | `/tdd`、`/diagnosing-bugs` |
| 泥球架构 | Agent 加速熵增，改一处炸一片 | `/codebase-design`、`/improve-codebase-architecture` |

核心主张只有一句：

> **软件工程基本功在 AI 时代不是过时了，而是变得更贵、更必要。**

Skills 只是把这些基本功压成可触发的纪律。

---

## 安装：30 秒起，先跑 setup

```bash
npx skills@latest add mattpocock/skills
```

安装时务必勾选 **`/setup-matt-pocock-skills`**，并在仓库里跑一遍：它会问你 issue tracker（GitHub / Linear / 本地文件）、triage 标签、文档落盘位置。

也可用 Claude Code 插件订阅（只读、跟官方版本走）：

```text
/plugin marketplace add mattpocock/skills
/plugin install mattpocock-skills@mattpocock
```

两种哲学：

- **skills.sh 拷贝进项目** → 可 fork、可改，适合团队定制；
- **插件订阅** → 不维护 fork，跟 Matt 发版走。

更新到 v1.1 同一条命令：`npx skills@latest add mattpocock/skills`。

---

## v1.1 主轴：从「会问」到「能跨会话交付」

v1.0 已经把 **User-invoked / Model-invoked** 分清：你手动触发的负责编排，模型可自触发的负责纪律。v1.1 的增量，集中在把「想法 → 可交付」做成**可导航的地图**，而不是一场超长对话。

### 主流程（日常默认门）

```text
idea
  → /grill-me 或 /grill-with-docs   （对齐）
  → /to-spec                        （合成规格，不再叫 to-prd）
  → /to-tickets                     （垂直切片 + 阻塞边）
  → /implement  （内驱 /tdd）
  → /code-review                    （标准轴 + 规格轴）
```

迷路时先 `/ask-matt`：它在 v1.1 补全了 tdd、diagnosing-bugs、domain-modeling、codebase-design、grilling 等路由，并新增「Something's broken」入口——以前坏了不知道从哪条 skill 进。

### 超大任务的旁路：`/wayfinder`

不是新的默认脊柱（Matt 明确说：把 wayfinder 捧成默认主链是 **v2 级改动**），而是**情境入口**：

- 绿地上项目 / 巨型功能，**一会话装不下**；
- 从 grill 发现「雾太大」，需要先画地图。

wayfinder 把旧的 decision-mapping 重命名并工程化：

- **目的地优先**：地图有 `## Destination`，一切票围绕它；
- **计划，不交付**：产出决策，不是代码；雾散了再进入实现链；
- **地图是索引**：决策只活在 ticket 里，地图只摘要+链接，防双写；
- **HITL vs AFK**：该人类拍板的票（grilling、prototype）绝不能让 Agent 自问自答；研究类可 AFK；
- **无雾早退**：开场 grill 若无雾，直接问你要不要进常规单会话流程，不硬造地图。

这直接对应社区吐槽：有人发现 Agent 用 grill「自己问自己」。v1.1 在 wayfinder 与 grilling 两侧一起堵。

### 作者本人最近在用的「升级路径」

Matt 在 2026-07-17 公开的新习惯流非常短，却极有用：

```text
1. /grill-with-docs <issue description>
2. 「我靠，这比我想的大多了」
3. /wayfinder 给这件事画地图
4. 继续干活
```

翻译成落地话术：**先 grill 测体积；一发现雾太大，立刻 wayfinder，不要硬撑单会话。**

他自己用 wayfinder 规划整门课程时写过：连续四天、接近 **100 次** grilling / prototyping / research 会话，全部回灌到一张**会长大、也会缩小**的中央地图——雾变清晰就毕业成决策，答案出现就从地图上消掉。这不是 demo 文案，是作者级真实工作负载。

---

## 五个最值得抄的 v1.1 硬改动

### 1. Grilling：确认闸门 + 事实/决策二分

这是 Twitter 上传播最广的修复。

**确认闸门**：在你明确确认「我们已经对齐」之前，Agent **不得开始执行计划**。旧版把「共享理解」当完成条件，模型容易自行宣布「对齐了」。

**事实 vs 决策**：

- **事实** → 去代码库/文档里查；
- **决策** → 必须问人，并等待回答。

旧规则「能靠探索代码库回答的就去探索」在「解 ticket」场景被滥用成「决策也自己拍」。二分之后，grilling 才是真 HITL，而不是表演式问答。

> 自测句：你用 `/grill-me` 时，Agent 是在**等你确认**，还是先猜答案再假装提问？

### 2. 规划统一：`to-spec` + `to-tickets`

- `to-prd` → **`to-spec`**（规格一词贯穿全链路）；
- `to-plan` + `to-issues` → **`to-tickets`**。

每张 ticket 是 **tracer-bullet 垂直切片**，并声明 **blocking edges**：

- 本地 `tickets.md`：边写成文字，你自上而下做；
- 真 tracker：边写成原生阻塞关系，**无阻塞票可并行多 Agent**。

另：教 **wide refactor**（列改名等「爆炸半径」铺满全库的机械改动）走 **expand–contract**，避免「一刀切永远绿不了」。

### 3. `code-review` 毕业 + Fowler 坏味道基线

`review` 从 in-progress 毕业为 **`code-review`**，并挂进 `/implement` 收尾。

双轴并行（子 Agent 互不污染）：

1. **Standards** —— 仓库规范 + 内置约 12 条 Fowler *Bad Smells*（神秘命名、重复代码、特性依恋、数据泥团、基本类型偏执、重复 switch、散弹式修改、发散式变化、夸夸其谈的通用性、消息链、中间人、被拒绝的遗赠……）；
2. **Spec** —— 是否忠实实现 originating issue/规格。

两条硬约束：仓库文档标准优先于基线；味道是**判断建议，不是硬违规**。

### 4. 新增 `research`：背景 Agent 读一手源

Model-invoked：对**官方文档、源码、规格、一手 API** 做调查，落一份带引用的 Markdown。你继续干主线，它帮你做「可烧烤的阅读底稿」。

### 5. `writing-great-skills`：否定与负空间

写 skill 的人必读。两个新失效模式：

| 模式 | 隐喻 | 问题 | 疗法 |
|------|------|------|------|
| **Negation** | 大象 | 「不要做 X」反而把 X 拉进上下文 | 写**正向**要做什么 |
| **Negative Space** | 虚空 | 省略的决策被模型先验填满 | 刻意审「沉默」：补全，或显式标成 **branch** |

这比「把提示词写长一点」高级一个数量级——它承认：**你以为关掉的开关，其实还在导流。**

---

## TDD 与 prototype：更信模型，也更狠防假绿

**TDD 变 reference-only**：红→绿由模型已内化的 leading word 驱动，删掉重复 Workflow；重构归 review 阶段。引入 **seam**——只在与用户预先约定的缝上写测。新增 **同义反复测试** 反模式：断言用和实现同一套算法重算，测了等于没测。

**prototype 改为 model-invoked**：Agent 可在「状态/逻辑摸底」或「UI 多方案探索」时自己伸手，产物是**可扔的回答设计问题的代码**，不是半永久功能分支。

---

## 一张图记住：什么时候用什么

| 你的处境 | 先调什么 |
|---------|---------|
| 需求含糊、怕做错 | `/grill-me` 或 `/grill-with-docs` |
| 项目黑话太多、Agent 啰嗦 | grill-with-docs + domain-modeling / `CONTEXT.md` |
| 想法已对齐，要落规格 | `/to-spec` → `/to-tickets` |
| 单会话装不下的大工程 | `/wayfinder`（产出决策地图，不是立刻写码） |
| 开写功能 | `/implement`（内驱 `/tdd`） |
| 提交前 | `/code-review` |
| 难缠 bug | `/diagnosing-bugs` |
| 需要一手资料 | `/research`（背景跑） |
| 不知道从哪进 | `/ask-matt` |

---

## 推特上的可抄干货（比「屠榜」更有用）

下面几条不是情绪热评，是可以直接搬进你工作流的**可验证做法**。

### 1）Wayfinder 解决「grill 问到崩溃」

**@Dayhaysoos（Nick）** 实测：一次 **51 问** 的 grill-me 中途 compact 后信心崩掉，改从 wayfinder 重开，结论是：

- Wayfinder **更会画边界**；grill-me 在你不熟的领域容易越跑越偏；
- 有的 ticket 像 grill（要人），有的纯 research（可 AFK，不挡你）；
- 地图让你敢 **compact / 换新 Agent** 再续，上下文对新手线程仍然好用。

这和 v1.1 的 HITL / AFK 分类、确认闸门是同一条产品逻辑。

### 2）把自定义 skill 挂进 Wayfinder 当编排器

**@WillNessAI**（Matt 亲自转发并点赞）：基于 grilling + prototype 做了一套 **前端专用** 变体——

1. 让 Claude 先做 **5 个差异极大** 的原型；  
2. 做一个 **live picker** 现场切换；  
3. 每轮选中意的分支 + 反馈，沿设计树缩小范围；  
4. **写回 wayfinder**：凡是新地图里出现 novel frontend 工作，自动生成 ticket，强制走这套 frontend grilling。

Matt 的点评只有两句，但都是干货：

- 把 **/wayfinder 当自定义 skill 的编排器**；
- 多阶段原型是在 **上下文里一次只 zoom 一块 UI**。

可复用模式：**公司规范不要散落成口头习惯，写成 skill，再挂到 wayfinder 的 ticket 类型上。**

### 3）批量烤问：13 问从 13 轮压到 3 轮

Matt 自己在推：**/batch-grill-me** 体感明显好于逐题 `/grill-me`：

- Before：13 个问题，13 轮；  
- After：13 个问题，**3 轮**；  
- 仍然只问 **frontier**（不依赖其他未决决策的问题）；  
- 研究类任务丢给 **background agent**，不堵 grilling。

如果你也嫌 grill 太「一问一答 intermediate」，优先关注 batch / 多题并行形态（官方 skill 名以你安装版本为准）。

### 4）中文社区的二次工程化

**@seekjourney** 开源了基于 grilling 的优化版：提高问题质量、降决策成本、反噪音与反过度设计；最大改动是**优先用运行时** `request_user_input` / `AskUserQuestion` 真提问，而不是让模型在文本里假装等你。

方向正确：**把 HITL 接到 harness 的真实交互原语上。**

### 5）定位口令：给谁超能力？

Matt 对比 superpowers 时写得很干净：

> Superpowers gives the agent superpowers  
> My skills give you superpowers

选型时先问一句：你要的是 **Agent 更会自己干**，还是 **你更会指挥 Agent**？两套可以共存，别混成一团提示词。

---

## 社区在吵什么、你该警惕什么

1. **可复用 > 一次性聪明**  
   热门解读一致：技能要可检查、可版本化、可组合——不是聊天记录里的「那次挺灵」。

2. **Harness 碎片化**  
   有开发者指出：这套为 Claude Code 的 `/skill` 假设优化，在 Codex / 部分 harness 上「斜杠调用」体验不一致。落地时先确认你的 Agent 运行时如何加载 Agent Skills 标准。

3. **二次魔改正在发生**  
   中文圈已有人基于 grilling 加 `request_user_input` / `AskUserQuestion`，强化「真提问」。说明正确姿势是：**当基础协议，而不是当宗教**。

4. **星标≠你公司能用**  
   17.5 万 Star 证明话题热；真正 ROI 来自：setup 一次、统一术语、默认走 grill→spec→tickets，并在 code-review 用仓库标准覆盖 Fowler 基线。

---

## 给你的 7 天落地清单

**Day 1**  
装 skill + 跑 `/setup-matt-pocock-skills`；选 tracker。

**Day 2**  
挑一个真实小需求，强制 `/grill-me` 到**你口头确认对齐**才允许写码。故意观察：它是否还在替你做产品决策。

**Day 3**  
给主项目建或补 `CONTEXT.md`（10～30 条领域词足够）。对比同一句需求在补前后的 token 与命名一致性。

**Day 4**  
用 `/to-spec` + `/to-tickets` 拆一张中等功能；检查每张票是否有阻塞边，能否并行。

**Day 5**  
开 `/implement`，约定 **test seam**；拒绝 tautological tests。

**Day 6**  
强制 `/code-review`；把 1～2 条反复出现的 smell 写进仓库 `CONTRIBUTING` 或 coding standards。

**Day 7**  
若手头有跨周大项，跑一次 `/wayfinder`：只决策、不写码；看地图是否降低「会话失忆」。

---

## 结语：把潜意识流程，升级成可版本化资产

Twitter 上那句 *patterns every senior dev uses unconsciously* 点破了价值：

- 资深工程师的「多问一句、先对齐、再垂直切片、再评审」不是玄学；
- AI 时代的差异，是这些纪律能否 **可安装、可组合、可在 PR 里被检查**。

mattpocock/skills **v1.1** 的意义，不是又堆了几个 slash command，而是：

1. 用 **确认闸门 + 事实/决策二分** 堵住「Agent 自问自答」；
2. 用 **to-spec / to-tickets / implement / code-review** 收束交付链；
3. 用 **wayfinder** 诚实承认：有些工作一会话装不下，该先画雾中的地图；
4. 用 **writing-great-skills** 教你写下一层——你自己的团队 skill。

命令仍是那一行：

```bash
npx skills@latest add mattpocock/skills
```

装完以后，真正难的一步是：**下次冲动让 Agent「直接开写」时，先按下 grill 的确认闸门。**

仓库与版本：https://github.com/mattpocock/skills · Release v1.1.0

---

我是 **ziikoo研究院**，持续跟踪 AI 工程、Agent 工作流与企业落地实践。

如果你觉得今天这篇有收获，欢迎**点赞、在看、转发**三连，我们下篇见。

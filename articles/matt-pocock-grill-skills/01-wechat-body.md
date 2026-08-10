---
title: 先别让 Agent 写代码：Matt 用 7 行 skill 把你先「烤」明白
author: ZIIKOO TALK
description: Agent 一上来就写代码，十有八九在猜。Matt Pocock 的 grill-first：先把你烤明白，再 to-spec / implement / 双轴 review。
---

# 先别让 Agent 写代码：Matt 用 7 行 skill 把你先「烤」明白

你丢一句需求，Agent 立刻开写。写完一看：接口名是它猜的，边界是它编的，测试是它自嗨的。

问题往往不在模型「不够聪明」，而在它**开工前没拿到准确上下文**——你心里有半套决策，对话里只写了三成。

Shann³ 最近转发并拆解了 **Matt Pocock**（Total TypeScript / AI Hero）那套 **grill-first** skill 包：核心只有一句——

> **先把人问明白，再让智能体碰代码。**

这不是又一坨提示词合集。它是一套可触发的工程纪律：用极短的 skill（`/grill-me` 号称只有 7 行）**一次只问一个问题**，把决策烤到你签字为止；再进规格、拆票、实现、双轴评审。

适合 Claude Code，也适用于其他 agent harness（**执行 Agent 的壳/编排环境**）。

## 30 秒说清：grill-first 在干什么

| 阶段 | 你在做什么 | 典型 skill |
|------|------------|------------|
| 对齐 | 被逐问、逐拍板，统一用词 | `/grill-me`、`/grill-with-docs` |
| 规格 | 对话收成规格，不再瞎聊 | `/to-spec` |
| 拆票 | 垂直切片 + 写清阻塞 | `/to-tickets`、`/wayfinder` |
| 实现 | 按规格/票做，带 TDD | `/implement`、`/tdd` |
| 验收 | 标准轴 + 规格轴双审 | `/code-review` |

主链路长这样：

```text
idea
  → grill（对齐）
  → to-spec
  → to-tickets
  → implement（内驱 tdd）
  → code-review（双轴）
```

**为什么有效**：AI 产出「空、泛、像模板」，常见根因是 **Agent 在猜**。grilling 逼你把模糊选择变成可执行决策，并把人和 Agent 拉到同一套词汇上。

## 全 skill 清单：每个干什么

下面按 Shann 的分类翻译整理。命令名保留英文，方便你对着仓库直接敲。

### 1. 访谈 / 拷问（Interview）

- **`/grill-me`**：7 行级 skill，一次一问，直到每个决策都落定
- **`/grilling`**：`grill-me` 与 `grill-with-docs` 背后的可复用循环
- **`/grill-with-docs`**：同样先烤；边问边沉淀 **`CONTEXT.md` 术语表** 和 **ADR**（Architecture Decision Record，架构决策记录）

### 2. 领域与设计（Domain and design）

- **`/domain-modeling`**：打磨项目共享词汇与术语表
- **`/codebase-design`**：深模块设计——接口简单，功能藏深
- **`/improve-codebase-architecture`**：扫架构改进机会，输出 HTML 报告，再就你选中的那一项继续 grilling

### 3. 规格与规划（Spec and plan）

- **`/to-spec`**：把对话压成规格（不再重复面试），并可发到 issue tracker
- **`/to-tickets`**：规格拆成 tracer-bullet 工单（**先打穿一条端到端细路径**），每张票写清阻塞谁
- **`/wayfinder`**：一会话装不下的大活，拆成 tracker 上的调查票
- **`/triage`**：用角色状态机推进问题分诊

### 4. 构建（Build）

- **`/implement`**：按规格/工单实现，驱动 TDD，收尾 code-review
- **`/tdd`**：在约定接缝上红绿循环，一次一条垂直切片
- **`/prototype`**：用可扔代码回答设计问题（不负责上生产）
- **`/research`**：后台 agent 对照一手资料调研，留下带引用的文件

### 5. 评审与修复（Review and fix）

- **`/code-review`**：两个并行子 agent 并排出报告——一个对照你的标准，一个对照规格
- **`/diagnosing-bugs`**：复现 → 最小化 → 假设 → 埋点 → 修复 → 回归测试
- **`/resolving-merge-conflicts`**：按意图、逐 hunk 解冲突

### 6. 工作流胶水（Workflow）

- **`/ask-matt`**：按你的处境路由到合适 skill/流程
- **`/handoff`**：把对话压成文档，交给下一会话或下一个 agent
- **`/teach`**：跨会话教学，目录即有状态工作区
- **`/writing-great-skills`**：写/改 skill 的参考手册
- **`/setup-matt-pocock-skills`**：仓库一次性配置（tracker、文档落盘位置等）

## 它真正带给 builder 的价值

顺序是死的，也是活的：

1. **先 grill**：`/grill-me` 或 `/grill-with-docs`，一问一答到你签字
2. **再规格**：`/to-spec`
3. **再拆票**：`/to-tickets`
4. **再实现**：`/implement`
5. **再双审**：`/code-review`

grilling 在前，是为了消灭「猜」。  
猜没了，上下文才准；上下文准了，后面规格和代码才值得烧 token。

有人评论得很准：**先把人问明白，比一上来改代码靠谱多了。**  
也有人问：问题还很糊的时候，`grill-me` 能不能跑？——通常**需要一点粗方向**（你在解决什么、给谁、约束大概是什么）；完全零想法时，先用 brainstorm/原型探一圈，再进 grill，会更顺。

## 附录：三条「先规划再开工」的流水线

Shann 把日常 AI 构建过的三套框架摆在一起。三者纪律相同：**先对齐，再让 agent 动手。**

### 1. Superpowers（Jesse Vincent）

面向 Claude Code 的 skill 框架：写代码能用，做 campaign 也能用。

流水线：

- 头脑风暴，浮出需求
- **先锁规格**，再动工
- 拆成小任务
- 并行 subagent，一任务一 agent
- **对照规格**做全量 review

要点：开发从不无规格写生产代码；Superpowers 把同一套纪律带进营销——brief、任务表、评审一条龙。

### 2. g-stack（Garry Tan）

整场 sprint 一条方法：从规格一路到上线（含变现视角），二十多个专家 skill。

sprint 骨架：

- 先规格，再构建
- 用不同镜头 review：CEO / 工程 / 设计 / DevEx
- QA，再 ship
- **每个镜头抓别的镜头漏掉的**

原则：没过 reviewer，不进生产。

### 3. Matt Pocock skills

**grill-first**：动手前先拷问你。

循环：

- `grill-me` / `grill-with-docs` 问到决策落定
- 人和 agent **共用同一套词**
- 然后 `to-spec` → 带 TDD 的 `implement` → `code-review`

grilling 专治错位：产出空泛，多半是 agent 在猜。

## 推荐组合顺序（可转存）

Shann 的建议可以直接抄：

```text
1) Matt grill-first   → 搞清楚你到底要什么、词怎么统一
2) Superpowers 或 g-stack → 锁规格、拆任务、多镜头审、再 ship
```

同一顺序不只服务写代码：发 launch、写定位文档，一样干净。

| 你卡在哪 | 先用谁 |
|----------|--------|
| 需求糊、词不统一、做完才发现偏航 | Matt `/grill-me` / `/grill-with-docs` |
| 规格有了，要并行拆任务 + 对照规格验收 | Superpowers |
| 要一整场 sprint 到上线，多角色 review | g-stack |
| 架构腐化、模块边界糊 | Matt `/codebase-design`、`/improve-codebase-architecture` |
| 会话太长要交接 | Matt `/handoff` |

安装入口（与官方 skill 仓库一致时）：

```bash
npx skills@latest add mattpocock/skills
```

装完务必跑一次 **`/setup-matt-pocock-skills`**，把 tracker 和文档落盘位置配好。

## 站队结尾

Agent 时代最贵的不是模型调用次数，而是**你以为对齐了、其实全在猜**。

Matt 这套东西尖锐的地方在于：它不给你「更会写」的幻觉，它逼你**先当个肯被问的人**。

你可以继续一句话甩锅给 Claude。  
也可以从下一次需求开始，先敲 `/grill-me`，忍过那一连串讨厌但值钱的问题。

**评论区选一个：**

- A. 我先装 skill，下次需求强制 grill
- B. 我已有 Superpowers / g-stack，只补 grilling 前段
- C. 我还在 vibe，先观望

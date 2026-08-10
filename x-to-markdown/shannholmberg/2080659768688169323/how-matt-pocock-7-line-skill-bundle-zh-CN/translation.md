---
sourceUrl: "https://x.com/shannholmberg/status/2080659768688169323"
sourceAuthor: "Shann³ (@shannholmberg)"
sourceTitle: "how @mattpocockuk's 7-line skill bundle improve AI context gathering"
sourceCreatedAt: "2026-07-24T14:22:00Z"
title: "Matt Pocock 的 7 行 skill 包如何改进 AI 上下文采集"
lang: zh-CN
mode: normal-localized
wechatArticle: "../../../../../articles/matt-pocock-grill-skills/01-wechat.md"
---

# Matt Pocock 的 7 行 skill 包如何改进 AI 上下文采集

这是一套面向 Claude Code（或其他 agent harness）的 **grill-first（先拷问再开工）** 工作流：在智能体动手改你的代码库之前，先访谈你，确保上下文尽可能准确。

每个 skill 及其作用：

## 访谈

- **`/grill-me`**：约 7 行的 skill，一次只问一个问题，直到每个决策都落定
- **`/grilling`**：支撑 `grill-me` 与 `grill-with-docs` 的可复用循环
- **`/grill-with-docs`**：同一套拷问流程，同时边问边建立 `CONTEXT.md` 术语表和 ADR

## 领域与设计

- **`/domain-modeling`**：打磨项目的共享词汇与术语表
- **`/codebase-design`**：深模块设计——简单接口，藏深功能
- **`/improve-codebase-architecture`**：扫描架构机会，写出 HTML 报告，再就你选中的那一项继续 grilling

## 规格与规划

- **`/to-spec`**：把对话压成规格（不再面试），并发布到你的 tracker
- **`/to-tickets`**：把规格拆成 tracer-bullet 工单，每张票声明阻塞关系
- **`/wayfinder`**：把单会话装不下的工作拆成 tracker 上的调查票
- **`/triage`**：用分诊角色状态机推进 issue

## 构建

- **`/implement`**：按规格或工单实现，驱动 TDD，以 code-review 收尾
- **`/tdd`**：在约定接缝上红绿循环，一次一条垂直切片
- **`/prototype`**：用可丢弃代码回答设计问题
- **`/research`**：后台 agent 对照一手资料调研，留下带引用的文件

## 评审与修复

- **`/code-review`**：两个并行子 agent 并排报告——一个对照你的标准，一个对照规格
- **`/diagnosing-bugs`**：复现、最小化、假设、埋点、修复、回归测试
- **`/resolving-merge-conflicts`**：按意图、逐 hunk 解决冲突

## 工作流

- **`/ask-matt`**：按你的处境路由到合适的 skill 或流程
- **`/handoff`**：把对话压成文档，交给下一个 agent 或会话
- **`/teach`**：跨会话教学，目录作为有状态工作区
- **`/writing-great-skills`**：编写与修改 skill 的参考
- **`/setup-matt-pocock-skills`**：配置仓库，运行一次即可

## 它给 builder 带来的价值

grilling 永远在前。`/grill-me` 与 `/grill-with-docs` 一次一问，直到你为每个决策签字。只有在此之后，`/to-spec` 才写规格，`/to-tickets` 才拆票，`/implement` 才构建，`/code-review` 才做双轴检查。

---

## 引用帖：我做每次 AI 构建都会过的 3 套规划框架

**来源：** https://x.com/shannholmberg/status/2076033805241249895

每一套都强迫同一纪律：**先规划、对齐，再让 agent 构建。**

### 1. Superpowers（Jesse Vincent）

面向 Claude Code 的 skill 框架，逼你先规划再构建；代码或 campaign 都适用。

Superpowers 流水线：

- 头脑风暴想法，浮出需求  
- 动工前锁死规格  
- 把工作拆成小任务  
- 并行跑 subagent，一任务一个  
- 对照规格做全面 review  

开发者从不无规格写代码；Superpowers 把同一纪律带进营销——brief、任务列表与评审在一条流里。

### 2. g-stack（Garry Tan）

完整 sprint 方法论：从规格到生产（甚至擅长变现），自带 23+ 专家 skill。

g-stack sprint：

- 先规格，再构建  
- 用不同镜头 review：CEO、工程、设计、DevEx  
- QA，再 ship  
- 每个镜头抓住其他镜头漏掉的  

没有先过 reviewer，任何东西都不进生产。

### 3. Matt Pocock 的 skills

grill-first：构建前先访谈你。

Pocock grill 循环：

- `grill-me` 与 `grill-with-docs` 问到每个决策落定  
- 你与 agent 最终对同一事物使用同一词汇  
- 然后 `to-spec`、带 TDD 的 `implement`、以及 `code-review`  

grilling 避免错位——AI 输出空泛，通常是因为 agent 在猜。

建议串联使用：先用 Pocock 的 grilling 弄清你要什么，再用 Superpowers 或 g-stack 规划并交付。同一顺序做 launch 或定位文档，和写代码一样干净。

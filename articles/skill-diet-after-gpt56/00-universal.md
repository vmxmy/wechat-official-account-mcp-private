# 通用稿｜GPT-5.6 之后，Skill 与编排要做减法

> 用途：唯一内容源。公众号 / X / 小红书从此稿改写，三端独立成稿。  
> 结构强制：**开头先给可抄 Prompt** → 双端清理对比 → X 高赞观点 → 方法与边界。

---

## 0. 可直接抄的 Prompt（先用）

### Codex：让它自己清 Skill（推荐默认）

```text
扫描 ~/.codex/skills（含软链/镜像），结合最近 session 日志：

1) 列出：30 天内未使用 / 功能重复 / 只做发现与安装的 skill
2) 建议：保留 / 隔离 / 删除，每条写清理由与替代项
3) 经我确认后，把建议移除的移到 ~/.codex/skills/_quarantine/
4) 不要碰 .system 里的官方 skill，除非我点名
5) 限制 find-skills：只发现，不自动 install

先给 diff 计划，我确认后再执行。
```

### Codex：定期「自进化」版（日志驱动）

```text
scan my local codex session logs, look for common failure patterns,
then find, create, install, remove and/or modify skills to address those patterns.

Show a plan and file diffs first. Do not apply until I approve.
Run this as a maintenance pass, not a one-off install spree.
```

### Claude Code：走原生体检（有则用）

```text
运行 /doctor（或 /checkup）。
重点：unused skills、MCP、plugins 冗余；CLAUDE.md 去重；能省 context 的项列清单。
先报告，再按我的确认清理。
```

> 原则：**Claude 有菜单式体检；Codex 用自定义 Prompt + 写盘能力完成同等工作。**  
> 两边都先计划、后执行，官方 `.system` skill 默认不动。

---

## 1. 一句话主张

GPT-5.5 时代大家在加 Skill；GPT-5.6 / Sol 时代，更多人在删 Skill、砍 AGENTS.md、默认单 Agent。  
**模型越勤，harness 越要瘦。**

---

## 2. Claude Code cleanup vs Codex 自定义提示词

| | Claude Code | Codex |
|---|---|---|
| 原生入口 | `/doctor`、`/checkup`：诊断配置、清 unused skills/MCP/plugins、dedup 配置、省 context | **没有同等原生体检命令**（社区明确对比） |
| 怎么清 | 跑内置命令 → 看报告 → 确认清理 | **直接下 Prompt**：扫 `~/.codex/skills` + session 日志 → 计划 → 隔离/删除 |
| 优势 | 路径固定、体验统一 | 灵活：可按失败模式改 skill（增删改一体） |
| 风险 | 依赖版本/命令名 | 依赖权限与确认；`find-skills` 可能越清越装 |

**结论（写作要用的）：**

1. 不是 Codex「不能清」，是 **入口在对话，不在菜单**。  
2. Claude 的 cleanup 是产品能力；Codex 的 cleanup 是 **harness 能力 + 你的维护 Prompt**。  
3. 5.6 之后更该把「清理 Prompt」当成常驻运维，而不是再装一堆清理工具。

---

## 3. 推上高赞 / 高讨论观点与建议（可引用）

### 观点 A · 模型变强 → 默认做减法（高频共识）

- 口令式总结：**gpt 5.5 : add skills / gpt 5.6 : remove old skills**  
- 「5.6 了，好好清理之前的 skill，有些反而拖慢模型」  
- 高强度 Sol 后：**AGENTS.md 删大半**——约束太多成干扰  
- 直接 **gutted skills**，去掉 overly ambitious / superpowers 一类  
- 有人 **删光 skill** 后用 Sol 带 Terra、Luna 打杂，顶掉厚流程  

**建议：** 先减再调；别用更多 skill 解决 skill 过多。

### 观点 B · Skill 太多会拖慢 Codex（可观测）

- Skills 变多 → Codex 变慢；**减到约 11 个后明显更快**  
- 警惕常驻 **`find-skills`**：会按需下载 skill；应删除或限制为 **只发现不安装**  

**建议：** 给「技能库存」设上限；发现通道与安装通道分离。

### 观点 C · 让 Agent 自己维护 Skill（自进化）

高互动提示结构（Paul Bettner 等）：

> 扫本地 session 日志 → 找常见失败模式 → **find / create / install / remove / modify skills**  
> 经常跑，agent 会随时间变好  

**建议：** 清理不是一年一次大扫除，是 **日志驱动的小循环**。

### 观点 D · Claude 有 /doctor，Codex 要自己补

- Claude Code：`/doctor`（checkup）清 unused skills/MCP、dedup  
- Codex：无原生对等物 → 社区补 cleanup skill，或用上文自定义 Prompt  

**建议：** 写文章时并列表格，避免只站一边。

### 观点 E · 编排变薄，模型变厚

- 默认：中等推理 + **单 Agent** + Skill **按需**  
- 开 Skill 前只问：**会不会改变当前任务的做法？**  
- AGENTS.md 只留「防反复错误」的红线；口号删掉  
- 最贵的浪费常是：**错误交付物上的正确劳动**（太勤、边界不清）  

**建议：** 省 Token 先管任务边界，再管参数表。

### 观点 F · 安装纪律（少装也是清理）

- 让 Codex 找 GitHub Skills ≠ 原样全装  
- 流程：看 license → pin commit → 查依赖权限 → 只留贴合自己的 → 加自己的规则 → 测  

**建议：** 「More Skills ≠ better agent」。

---

## 4. 可执行清单（不含第三方体检品牌）

1. 先跑文首 **Codex Prompt** 或 Claude **`/doctor`**，只要报告  
2. 30 天未用 / 重复 / 纯发现安装类 → 标隔离  
3. `find-skills`：删或限 discovery-only  
4. AGENTS.md 瘦身：说不清防哪个反复错误就删  
5. 超级流程 skill 默认关  
6. 默认单 Agent；并行前确认独立交付、不抢同一文件  
7. 模型分流：批处理低档，关键路径高档  
8. 确认后再执行隔离；官方 `.system` 默认保留  
9. 把「清理 Prompt」存进个人运维笔记，每周/每重大版本跑一次  

---

## 5. 边界

- 清理 ≠ 反 Skill：固定路径、验收、安全红线类应留  
- 先计划后写盘，避免模型「勤快地误删」  
- 热点窗口短；文章重点是 **方法可抄**，不是堆工具名  

---

## 6. 三端改写要点

| 端 | 开头 | 中段 | 结尾 |
|---|---|---|---|
| 公众号 | 可抄 Prompt 框 | Claude vs Codex 表 + 高赞观点 | 清单 + 停的时机 |
| X | 钩子 + Prompt 截断版 | 3–5 条高赞结论 | CTA 评论派别 |
| 小红书 | 封面「删 skill」 | 双端对比一页 + 清单页 | 行动：今晚跑 Prompt |

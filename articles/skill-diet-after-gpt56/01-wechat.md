# GPT-5.6 上线后，先别装 Skill，先跑这段 Prompt

很多人把 GPT-5.6 当成「更强的续杯」。  
拉开差距的，往往是另一件事：**你敢不敢做减法。**

这篇不推第三方清理工具。文首放好可以直接粘贴的维护指令，后面再说 Claude Code 与 Codex 各自怎么清，以及推上反复出现的高赞观点。

---

## 一、可直接抄的 Prompt

### 1）Codex：让它自己清 Skill

```text
扫描 ~/.codex/skills（含软链/镜像），结合最近 session 日志：

1) 列出：30 天内未使用 / 功能重复 / 只做发现与安装的 skill
2) 建议：保留 / 隔离 / 删除，每条写清理由与替代项
3) 经我确认后，把建议移除的移到 ~/.codex/skills/_quarantine/
4) 不要碰 .system 里的官方 skill，除非我点名
5) 限制 find-skills：只发现，不自动 install

先给 diff 计划，我确认后再执行。
```

### 2）Codex：按日志维护 Skill

```text
scan my local codex session logs, look for common failure patterns,
then find, create, install, remove and/or modify skills to address those patterns.

Show a plan and file diffs first. Do not apply until I approve.
```

### 3）Claude Code：跑原生体检

```text
运行 /doctor（或 /checkup）。
重点：unused skills、MCP、plugins 冗余；CLAUDE.md 去重；能省 context 的项列清单。
先报告，再按我的确认清理。
```

记住这句就够了：  
**Claude 的 cleanup 在命令里；Codex 的 cleanup 在你的 Prompt 里。**  
两边都先看报告，确认后再动文件。

---

## 二、为什么 5.6 之后更该清

社区有一句几乎成了口令：

> GPT-5.5：加 skill  
> GPT-5.6：删 skill

不是段子。高强度用完 Sol 之后，很多人第一件事就是 **gut skills**：砍掉野心过大的流程 Skill，把 AGENTS.md 删掉大半。

约束一多，模型开始被说明书牵着走；流程太重，强模型会「勤快地跑偏」。

最贵的 Token，经常花在 **错误交付物上的正确劳动** 上：  
每一步都做得很认真，交出来的却不是你要的东西。

---

## 三、Claude Code 的 cleanup，Codex 怎么办

| | Claude Code | Codex |
|---|---|---|
| 入口 | `/doctor`、`/checkup` | 没有对等原生体检命令 |
| 做什么 | 诊断配置、清 unused skills/MCP/plugins、配置去重、省 context | 让它扫描 `~/.codex/skills` 和日志，自行增删改 |
| 体验 | 菜单和命令稳定 | 更灵活，可按失败模式调整 skill 库存 |
| 使用习惯 | 定期跑一遍 | 把清理 Prompt 当成常驻运维 |

推上有开发者说得很直白：Claude 有 `/doctor`，Codex 没有原生版。有人补 cleanup skill，更多人直接写一段提示词，让 Codex 自己维护。

对多数人来说，这已经够用。Codex 本来就能读写本地 skill 目录，缺的是一份明确的维护要求。

还有两个常见坑：

1. **Skill 一多，Codex 会变慢。** 有人减到十来个，速度明显回来。  
2. **`find-skills` 会按需下载。** 清理时要么拿掉，要么限制成「只发现，不自动装」。

---

## 四、推上反复出现的五个判断

### 1. 模型变强，旧约束要重新审视

- 5.6 之后清理旧 skill，有些 skill 已经开始拖慢模型  
- AGENTS.md 删掉大半，留下来的约束反而更容易被执行  
- superpowers 一类野心过大的流程 skill，不再默认开启  
- 也有人干脆删光 skill，只让 Sol 带 Terra / Luna 分层打杂

做法很朴素：**把多余的减掉，再调剩下的；别用更多 skill 解决 skill 太多。**

### 2. 给库存设一道硬门槛

Skill 太多会拖慢启动和判断。有人把个人库压到十来个常用项，速度很快就回来了。

发现和安装也要拆开。模型可以帮你找，但不该找到什么就装什么。核心库设个上限，剩下的先放隔离区。

### 3. 维护依据来自 session 日志

一套常见的提示结构是：

> 扫 session 日志 → 找常见失败模式 → find / create / install / remove / modify skills

这件事隔一段时间跑一次就够了。日志会告诉你哪些规则真的救过场，哪些只是摆在目录里占位置。

### 4. 编排薄一点，模型才能把力气用对地方

- 默认单 Agent，需要时才开 Skill  
- 开 Skill 前问一句：**它会改变当前任务的做法吗？**  
- AGENTS.md 只留防止老错误复发的红线，口号和项目介绍放回 README

想省 Token，把任务边界说清楚通常比抠参数更有用。

### 5. 安装时就该考虑以后怎么删

让模型去 GitHub 找 skill，不等于把搜索结果原样装进本机。更稳妥的顺序是：

> 看 license → pin commit → 查依赖与权限 → 留下贴合自己的部分 → 实测

**More Skills ≠ better agent。**

---

## 五、今晚能做的 8 步

1. 打开 Codex，粘贴文首清理 Prompt，只让它出报告  
2. Claude 用户同步跑一遍 `/doctor`  
3. 标出未使用、功能重复、只负责发现安装的 Skill  
4. 处理 `find-skills`：删除，或改成 discovery-only  
5. 给 AGENTS.md 瘦身  
6. 默认关闭超级流程 Skill  
7. 检查报告后，再允许写入隔离目录  
8. 把这段 Prompt 存进个人运维笔记，下次大版本升级再跑

清理并不等于反对 Skill。固定路径、验收标准、安全红线都值得留下。

该删的是那些边界模糊、什么都想管的「正确流程」。

---

## 六、收尾

GPT-5.6 不缺能力。  
它需要一个知道 **什么时候该喊停** 的使用者。

执行可以交给 Agent。目标、品味和停手时机，自己拿着。

今晚把文首 Prompt 跑一遍。看完报告就停，别急着又装一批新 Skill。

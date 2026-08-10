# X / 推文独立稿

## 主帖

GPT-5.5：加 skill。  
GPT-5.6：删 skill。

别急着再装。  
先让 Codex 自己清一遍：

```
扫描 ~/.codex/skills + 最近 session 日志
列出未用/重复/纯发现安装
给 保留|隔离|删除 计划
确认后再移到 _quarantine/
.system 官方 skill 别碰
find-skills 只发现不自动装
```

Claude Code 用户：直接 `/doctor`。  
🧵 推上高赞在说什么

## 2

Claude 有 `/doctor` 清 unused skills/MCP。  
Codex 没有对等菜单——但能读写 `~/.codex/skills`。

所以 cleanup 在 Codex 上 = **自定义 Prompt**，不是装又一个清理器。

## 3

高赞维护咒语（日志驱动）：

scan session logs → failure patterns →  
find / create / install / **remove** / modify skills  

经常跑，agent 会自己变好。  
清理是运维循环，不是年底大扫除。

## 4

可观测：skills 太多 → Codex 变慢。  
有人减到 ~11 个，速度回来。

另：`find-skills` 会按需下载。  
清库时要么删，要么 discovery-only。

## 5

高频共识：

- AGENTS.md 删大半（约束太多=干扰）  
- gut superpowers 类流程 skill  
- 默认单 Agent，Skill 按需  
- 开 skill 前只问：会改变做法吗？  

最贵的浪费：错误交付物上的正确劳动。

## 6

More Skills ≠ better agent.  
安装纪律：license → pin → 依赖权限 → 只留贴合自己的。

你是 5.6 之后「加 skill」派，还是「删 skill」派？

#Codex #GPT56 #ClaudeCode #Agent

# 本机已安装的高星/高赞去 AI 味 Skill

安装根目录：`~/.agents/skills/`  
同步链接：`~/.codex/skills/`（软链）  
Claude 侧：`~/.claude/skills/`（已有同名目录，与 agents 源一致）

| 名称 | 仓库 | Stars(约) | 类型 | 路径 |
|------|------|-----------|------|------|
| humanizer | blader/humanizer | 29.9k | 英文写作 | ~/.agents/skills/humanizer |
| stop-slop | hardikpandya/stop-slop | 14.1k | 英文写作 | ~/.agents/skills/stop-slop |
| humanizer-zh | op7418/Humanizer-zh | 13.5k | 中文写作 | ~/.agents/skills/humanizer-zh |
| hallmark | Nutlope/hallmark | 13.5k | UI 设计 | ~/.agents/skills/hallmark |
| ai-flavor-remover | hylarucoder/ai-flavor-remover | 1.1k | 中文 Prompt | ~/.agents/skills/ai-flavor-remover |
| shuorenhua | MrGeDiao/shuorenhua | 0.75k | 中英写作 | ~/.agents/skills/shuorenhua |
| kill-ai-slop | yetone/kill-ai-slop | 0.64k | UI 设计 | ~/.agents/skills/kill-ai-slop |
| qu-ai-wei | LifelongLazyLearner/qu-ai-wei | 0.26k | 中文写作 | ~/.agents/skills/qu-ai-wei |
| remove-ai-flavor-writing | B1lli/remove-ai-flavor-writing-skill | 0.16k | 中文写作+审计脚本 | ~/.agents/skills/remove-ai-flavor-writing |

本机原有：`ai-slop-cleaner`（偏代码，非文章）

更新：
```bash
for d in humanizer stop-slop humanizer-zh ai-flavor-remover shuorenhua hallmark kill-ai-slop qu-ai-wei remove-ai-flavor-writing; do
  git -C ~/.agents/skills/$d pull --ff-only
done
```

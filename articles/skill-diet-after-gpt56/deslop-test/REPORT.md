# 去 AI 味 Skill 安装 + 效果测试报告

日期：2026-07-20  
测试方法：安装高星仓库到 `~/.agents/skills`；用 `remove-ai-flavor` 自带 `audit_ai_flavor.py` 做客观评分；按各 skill 规则对同一输入做改写对照。

## 1. 安装清单（高星优先）

| Skill | Stars | 用途 | 本机路径 |
|-------|------:|------|----------|
| humanizer | 29.9k | 英文 prose 去 AI 味 | `~/.agents/skills/humanizer` |
| stop-slop | 14.1k | 英文 prose 禁词/结构 | `~/.agents/skills/stop-slop` |
| humanizer-zh | 13.5k | 中文去 AI 痕迹 | `~/.agents/skills/humanizer-zh` |
| hallmark | 13.5k | UI 反 AI 味（非文章） | `~/.agents/skills/hallmark` |
| ai-flavor-remover | 1.1k | 中文润色 Prompt | `~/.agents/skills/ai-flavor-remover` |
| shuorenhua | 0.75k | 中英说人话 | `~/.agents/skills/shuorenhua` |
| kill-ai-slop | 0.64k | UI 通病图鉴（非文章） | `~/.agents/skills/kill-ai-slop` |
| qu-ai-wei | 0.26k | 中文 51 规则 + 门检 | `~/.agents/skills/qu-ai-wei` |
| remove-ai-flavor-writing | 0.16k | 中文壳清理 + **审计脚本** | `~/.agents/skills/remove-ai-flavor-writing` |

已同步软链到 `~/.codex/skills/`。  
`ai-flavor-remover` 原仓库无 `SKILL.md`，已本地补包装入口。

## 2. 测试输入

1. **合成重 AI 腔**（`00-input-synthetic-slop.md`）  
   故意堆：时代开场、赋能、真正重要的是、专家认为、综上所述、希望对您有帮助、你觉得呢  
2. **真实稿摘录**（`00-input-article-excerpt.md`，来自 `01-wechat.md` 开头/第二节/收尾）

## 3. 客观审计（`audit_ai_flavor.py`）

评分规则：score 越低越好；`pass` = 无 blocker。

### 3.1 合成 AI 腔

| 版本 | score | findings | blockers |
|------|------:|---------:|---------:|
| 原文 | **13** | 6 | 2 |
| stop-slop 改写 | **0** | 0 | 0 |
| humanizer-zh 改写 | 4 | 2 | 0 |
| remove-ai-flavor 改写 | 4 | 2 | 0 |
| qu-ai-wei 改写 | 2 | 1 | 0 |
| shuorenhua 改写 | 2 | 1 | 0 |

残留 findings 几乎全是「先…再」**机械先后顺序**。  
在运维/步骤文里这是合法结构，脚本会**误报**；若强拆，可读性下降。

### 3.2 真实公众号摘录

| 版本 | score | findings | blockers |
|------|------:|---------:|---------:|
| 原文摘录 | **10** | 4 | 2 |
| remove-ai-flavor 轻改 | 9 | 4 | 1 |
| 严格拆壳 | 视实现 | 更低 | 更低 |

解读：`01-wechat.md` **不是重 AI 营销腔**，主要是：
- 少量「不是…而是」「真正…」修辞壳  
- 流程文里的「先…再」顺序（多数应保留）

**不宜整篇过激 humanize**，否则会抹掉已有声口与节奏。

## 4. 各 skill 体验结论（写作向）

| Skill | 中文公众号适配 | 力度 | 推荐场景 |
|-------|----------------|------|----------|
| **remove-ai-flavor** | ★★★★★ | 中 | 有脚本可回归；拆壳准，误伤「先…再」需人工判断 |
| **qu-ai-wei** | ★★★★★ | 中-强 | 中文最完整；门检+语体+打磨报告；长文首选 |
| **humanizer-zh** | ★★★★☆ | 中 | 模式列表清晰；适合编辑审阅 |
| **shuorenhua** | ★★★★☆ | 可调 | 场景/Tier/scope 工程化好；长文可用 bounded |
| **stop-slop** | ★★☆☆☆ | 强(英) | 英文/中英混排散文；中文需配合 humanizer-zh |
| **humanizer** | ★★☆☆☆ | 强(英) | 英文正文；中文用 zh 版 |
| **ai-flavor-remover** | ★★★☆☆ | 强润色 | 是 Prompt 不是规范 skill；易扩写/改风格，要盯事实 |
| hallmark / kill-ai-slop | — | — | **UI 专用**，不用于文章 |

## 5. 对本篇 `01-wechat.md` 的建议

1. **不要**用 ai-flavor-remover 式「整篇重写成幽默大众风」——会改声口。  
2. **推荐管线（轻）**：  
   `remove-ai-flavor audit` → 人工确认 hits → `remove-ai-flavor` 或 `qu-ai-wei` 局部改  
3. 保留：Prompt 代码块、对比表、具体路径（`~/.codex/skills`）、金句若承担结构功能可留 1–2 处。  
4. 优先清：否定排比壳、助手腔、空洞拔高；**别为过审计而删光「先…再」**。

## 6. 快速复现

```bash
# 审计
python3 ~/.agents/skills/remove-ai-flavor-writing/scripts/audit_ai_flavor.py \
  articles/skill-diet-after-gpt56/01-wechat.md

# 更新 skill
for d in humanizer stop-slop humanizer-zh shuorenhua qu-ai-wei remove-ai-flavor-writing hallmark kill-ai-slop ai-flavor-remover; do
  git -C ~/.agents/skills/$d pull --ff-only
done
```

## 7. 产物目录

```
articles/skill-diet-after-gpt56/deslop-test/
  INSTALL.md
  REPORT.md
  00-input-*.md
  01-rewrite-*.md
  02-rewrite-article-excerpt-*.md
```

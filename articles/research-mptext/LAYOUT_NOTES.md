# 排版研究：有钱人为什么都喜欢整容怪？

- **来源**: https://mp.weixin.qq.com/s/wIQNrplZP6Nmg0qTD_pm_A
- **账号**: 杜绍斐 DUSHAOFEI (`shaofeidu` / `gh_2dd796e16eb0`)
- **作者**: Miss Ming
- **标题**: 有钱人为什么都喜欢整容怪？
- **摘要**: 权利与控制的游戏
- **时间**: 2025-05-23 12:30
- **数据**: mptext-api `down.mptext.top/api/public/v1/download` (html/json/text)

## 总体气质

长文八卦评论体，**图文穿插**，几乎不用复杂模块（无引用卡片、无彩色标题条）。
靠「默认正文 + 加粗点睛 + 少量黄底高亮 + 大量配图」撑节奏。

## 排版系统（从 inline style 统计）

### 正文
| 属性 | 主流值 | 次数量级 |
|------|--------|----------|
| color | `rgba(0,0,0,0.9)` / `rgb(68,68,68)` | 高 |
| font-size | **17px**（主文）/ 15px（次级） | 高 |
| font-family | **mp-quote, -apple-system-font, system** | 主文 |
| font-family 备选 | **宋体** | 部分段落/机排残留 |
| line-height | **1.5em** | 主文 |
| letter-spacing | **0.034em** | 主文 |
| font-weight | normal 为主，bold 点缀 | — |
| text-align | 多为默认左对齐；图注 center；少量 justify | — |
| margin/padding | 段落容器多为 0 | 紧凑 |

### 强调
- **加粗**约 26 处：用于关键判断句、反转句。
- **黄色高亮** `rgb(243,226,0)` / 背景 `rgb(255,238,51)`：极少（个位数），只砸在「一句金句/核心结论」上。

### 结构
- 标签：`span` 极多（样式嵌套）、`p`、`section`、`img` 为主。
- **图片约 43 张**：新闻截图、对比图、表情/配图，宽多 900–1250。
- 几乎**无**彩色 H2 底边、无代码块、无列表装饰。

### 页面
- 白底长文，中文阅读默认栈 + 微信 `mp-quote`。
- 图注：居中 + 略小/灰色倾向。

## 可复用到 wechat-article-styling 的要点

1. **正文 17px / 1.5em / letter-spacing 0.034em / color rgba(0,0,0,0.9)**
2. **强调：bold 优先，黄底高亮做「一针见血」而不是满屏**
3. **图多文短段落**：一段一事，便于插图
4. **不要花哨模块**：少用 callout/H2 蓝条，更像杂志专栏而非教程
5. 若移植为 style preset，可命名 `dushaofei-column` 或 `gossip-editorial`

## 文件
- `article.html` / `article.json` / `article.text` / `article.markdown`
- `style-analysis.json`

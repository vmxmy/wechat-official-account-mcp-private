# Translation Analysis

## Source overview
- **Title**: Graph Engineering: The Next AI Revolution
- **Author**: wandermist (@wandermist)
- **Type**: Tech essay / opinion post (X long-form article style)
- **Length**: ~1,100 words; short enough for single-pass translation
- **Domain**: AI systems design, multi-agent workflows, architecture patterns

## Domain & audience
- AI product builders, developers, and curious tech readers
- Audience preference for this job: **general** → plain language; annotate specialized jargon on first use
- Style preference: **technical** → precise, concise, documentation-adjacent; avoid overly literary flourish

## Tone & voice
- First-person, conversational opener ("wandermist here", "I almost didn't post this")
- Mostly explanatory essay: problem → definition → patterns → principles → close
- Direct, confident, lightly promotional CTA at end
- Technical style should keep clarity and structure; keep a mild conversational thread without slang

## Structure
1. Hook + framing of skill evolution (prompt → loop → graph)
2. Problem with linear AI
3. Definition of Graph Engineering
4. Why graphs matter (parallelism)
5. Fake edges / unnecessary dependencies
6. Diamond pattern
7. Verification > generation
8. More agents ≠ better
9. Humans still in the loop
10. System design closing + CTA

## Terminology (session glossary)

| English | Chinese | Notes |
|---------|---------|-------|
| Graph Engineering | 图工程（Graph Engineering） | First occurrence with EN; core coinage |
| prompt engineering | 提示词工程 | Standard |
| loop engineering | 循环工程（loop engineering） | Less standard; keep EN on first use |
| AI agent / agents | AI 智能体 | Glossary default |
| node | 节点 | Graph theory |
| edge / connection | 边 / 连接 | Prefer 连接 in prose; 假边 for "fake edges" |
| pipeline | 流水线 | |
| parallel execution / workers | 并行执行 / 并行工作者 | |
| Diamond Architecture / Diamond Pattern | 菱形架构 / 菱形模式 | |
| verification / reviewer | 校验 / 审核者 | |
| generation | 生成 | |
| workflow | 工作流 | |
| system design / systems designer | 系统设计 / 系统设计者 | |
| chatbots | 聊天机器人 | |

## Figurative language
- "wear every hat at once" → 一人身兼数职 / 同时戴多顶帽子
- "fake edges" → 假依赖边 / 伪边
- "creates disagreement before reaching agreement" → 先制造分歧，再达成共识
- "one capable agent often performs better than ten coordinated ones" → keep contrast crisp

## Translation challenges
1. Preserve markdown structure and all 6 image references (adjust path to `../imgs/` because output is in a subdirectory)
2. Keep technical precision of "graph" as architecture graph, not "chart"
3. First-use annotation for Graph Engineering and loop engineering
4. Avoid Europeanized long chains; break into short Chinese sentences where natural
5. Keep CTA and @wandermist link intact
6. Frontmatter: source-prefix original metadata; Chinese title in body H1

## Target settings
- **from**: en
- **to**: zh-CN
- **mode**: normal
- **audience**: general
- **style**: technical

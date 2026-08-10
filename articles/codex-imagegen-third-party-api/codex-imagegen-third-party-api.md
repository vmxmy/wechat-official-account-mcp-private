# Codex 第三方生图没被封：一次配置，永久解锁，支持多路并发

> 很多人看到第三方 Provider 无法调用 Codex 内置生图，就直接得出结论：Codex 不支持第三方图片 API。真正的问题是，他们只试了 `image_gen`，却没有认真读完官方 `imagegen` Skill。读完本文，你会分清两条执行路径，并完成一次配置、长期生效。

你让 Codex 生成一张图片。

官方登录时，它顺利出图；切到第三方 API 后，却提示图片能力不可用。

于是，大多数人的判断是：**Codex 把第三方生图封死了。**

这个判断只对了一半。

被限制的，往往只是 Codex 内置的 hosted `image_gen` 工具；而官方 `imagegen` Skill 还准备了另一条完整路径：**调用封装好的 Python CLI，再由 CLI 请求兼容的 Images API。**

更有意思的是，这条经常被忽略的路径不仅支持第三方 API，还能控制模型、尺寸、质量、输出路径，甚至原生支持批量任务和并发。

我们实际跑了一次 5 路并发：5 张全部成功，总墙钟时间 34 秒。

所以，真正的问题不是“Codex 支不支持第三方生图”，而是：**你有没有告诉 Codex，应该走哪条路。**

---

## 01 先纠正一个误区：imagegen 不是只有内置生图

打开本地官方 Skill：

```text
~/.codex/skills/.system/imagegen/SKILL.md
```

开头已经写得非常明确：`imagegen` 只有两个顶层模式。

| 模式 | 真正的执行者 | 是否需要 API Key | 更适合什么场景 |
|---|---|---:|---|
| 内置工具模式 | Codex 内置 `image_gen` | 否 | 官方订阅、日常单图、自然语言交互 |
| CLI/API 模式 | `scripts/image_gen.py` + Images API | 是 | 第三方 API、批量、并发、显式参数控制 |

这里最容易被误解的一点是：**CLI 和 API 并不是两套互相独立的能力。**

CLI 是官方已经封装好的 Python 客户端；它在底层使用 OpenAI Python SDK，请求：

```text
POST /v1/images/generations
POST /v1/images/edits
```

然后自动完成参数校验、请求发送、重试、`b64_json` 解码和图片落盘。

换句话说，你不需要再写一份 SDK Demo，也不需要自己处理 Base64。

官方已经把脏活做完了。

> 内置模式解决“开箱即用”，CLI/API 模式解决“可控、可换、可批量”。它们是同一个 Skill 的两条执行路径。

---

## 02 为什么大家会误判“不支持第三方 API”

因为很多人只切换了 Codex 的编程 Provider。

例如，在 CC Switch 里把 Codex 从官方 Provider 切换到一个第三方 OpenAI 兼容地址，然后直接对 Codex 说“生成一张图片”。

但官方 Skill 的默认规则是：**普通生图请求优先使用内置 `image_gen`。**

此时，如果第三方 Provider 不支持 Codex 的 hosted tool，或者当前登录组没有启用内置图片能力，调用自然会失败。

这不等于 Python CLI 失败，更不等于 Images API 失败。

真正需要验证的是三件事：

1. 第三方服务是否能正常鉴权；
2. 模型列表中是否存在 `gpt-image-2` 或兼容图片模型；
3. `/v1/images/generations` 是否真的接受并完成请求。

尤其要注意：**模型列表里有 `gpt-image-2`，不代表接口一定完整兼容。**

有些服务只把模型名称放进 `/models`，却没有实现图片生成端点；还有一些能出图，但会忽略尺寸、格式或透明背景参数。

因此，别只看模型名。一定要发起一次真实的低质量测试请求。

---

## 03 一次配置：让官方 CLI 指向第三方 API

官方脚本位置：

```bash
export IMAGE_GEN="$HOME/.codex/skills/.system/imagegen/scripts/image_gen.py"
```

首次使用，安装 OpenAI Python SDK：

```bash
uv pip install openai
```

然后设置两个标准环境变量：

```bash
export OPENAI_BASE_URL="https://你的第三方域名/v1"
export OPENAI_API_KEY="你的 API Key"
```

为什么不用修改官方脚本？

因为 `image_gen.py` 内部直接创建 `OpenAI()` 和 `AsyncOpenAI()` 客户端，OpenAI SDK 会读取标准的 `OPENAI_BASE_URL` 与 `OPENAI_API_KEY`。

所以，不需要给脚本增加 `--base-url`，也不要 Fork 或修改系统 Skill。

### macOS / zsh 永久生效

把下面三行加入 `~/.zprofile`：

```bash
export OPENAI_BASE_URL="https://你的第三方域名/v1"
export OPENAI_API_KEY="你的 API Key"
export IMAGE_GEN="$HOME/.codex/skills/.system/imagegen/scripts/image_gen.py"
```

重新加载：

```bash
source ~/.zprofile
```

Linux Bash 用户可以写入 `~/.bash_profile` 或 `~/.bashrc`。

安全要求只有一条：**不要把真实 Key 写进仓库、Prompt、截图或聊天记录。**

如果你所在团队对密钥管理要求更高，应改用系统钥匙串、密码管理器或 Secret Manager，在启动 Codex 前注入环境变量。

---

## 04 再加一条规则：让 Codex 永久优先走第三方 CLI

只配置环境变量，解决的是“脚本往哪里请求”。

但官方 Skill 默认仍然优先使用内置 `image_gen`。如果你不想每次都补一句“请走 CLI/API 模式”，还需要给 Codex 一条长期偏好。

在项目的 `AGENTS.md` 中加入：

```markdown
## Image generation preference

- For image generation and image editing, use the official imagegen Skill's fallback CLI/API mode.
- Use `$HOME/.codex/skills/.system/imagegen/scripts/image_gen.py`.
- Read `OPENAI_BASE_URL` and `OPENAI_API_KEY` from the environment.
- Prefer `gpt-image-2` for normal generation and editing.
- For multiple distinct assets, use `generate-batch` with explicit concurrency.
- Do not use the built-in `image_gen` tool unless the user explicitly requests the subscription-backed built-in mode.
- Never print, persist, or ask the user to paste the full API key.
```

这段规则本身就是一次明确的用户授权，因此不会与官方 Skill 的“默认优先内置工具”规则冲突。

如果你使用 CC Switch，可以把这段内容放进它的 Prompt / `AGENTS.md` 管理里，再保存成一个“第三方生图”项目配置。

以后切换项目时，Provider、MCP、Skills 和 Prompt 偏好可以一起恢复。

但要记住：**CC Switch 负责切换和同步配置，真正调用图片接口的仍然是官方 Python CLI。**

---

## 05 先跑一张：验证第三方 Images API

配置完成后，用低质量方图做最小测试：

```bash
python "$IMAGE_GEN" generate \
  --model gpt-image-2 \
  --prompt "A simple blue circle centered on a plain white background, no text, no watermark" \
  --quality low \
  --size 1024x1024 \
  --out output/imagegen/api-test.png \
  --no-augment
```

如果看到：

```text
Calling Image API (generation)
Generation completed
Wrote output/imagegen/api-test.png
```

说明最关键的链路已经打通：

```text
Codex
  ↓
官方 imagegen Skill
  ↓
image_gen.py
  ↓
第三方 /v1/images/generations
  ↓
本地 PNG
```

以后你在 Codex 中只需要说：

```text
使用 imagegen CLI/API 模式和 gpt-image-2，生成一张 SaaS 官网 Hero 图。
横版，右侧主体，左侧留出标题空间，不要文字和水印。
保存到 ./images/hero.png。
```

如果已经写入 `AGENTS.md`，甚至不必再强调 CLI/API 模式。

---

## 06 真正的隐藏能力：5 路并发批量生图

内置 `image_gen` 更偏向对话式单图生成。

而官方 Python CLI 直接提供了：

```text
generate
edit
generate-batch
```

其中 `generate-batch` 支持异步并发。

先准备 `prompts.jsonl`：

```jsonl
{"prompt":"AI Agent 调研信息源，编辑插画，白底，黑色线稿，橙色强调，无文字","out":"01-research.png"}
{"prompt":"AI Agent 拆解开发计划，编辑插画，白底，黑色线稿，橙色强调，无文字","out":"02-plan.png"}
{"prompt":"AI Agent 编写代码，编辑插画，白底，黑色线稿，橙色强调，无文字","out":"03-code.png"}
{"prompt":"AI Agent 执行测试，编辑插画，白底，黑色线稿，橙色强调，无文字","out":"04-test.png"}
{"prompt":"AI Agent 审查提交，编辑插画，白底，黑色线稿，橙色强调，无文字","out":"05-review.png"}
```

然后执行：

```bash
python "$IMAGE_GEN" generate-batch \
  --input prompts.jsonl \
  --model gpt-image-2 \
  --quality low \
  --size 1024x1024 \
  --out-dir output/imagegen/agent-workflow \
  --concurrency 5 \
  --max-attempts 3 \
  --no-augment
```

这里有两个容易混淆的参数：

- `--n 5`：同一个 Prompt 生成 5 个变体；
- `generate-batch`：5 个不同 Prompt 分别生成不同资产。

做网站功能图、游戏素材、公众号配图时，通常应该使用 `generate-batch`。

---

## 07 我们实测了什么

为了验证这不是“理论可行”，我们使用一个第三方 OpenAI 兼容入口进行了真实测试。

测试入口为某第三方 OpenAI 兼容服务，具体地址已隐去。

首先，`GET /v1/models` 返回 HTTP 200，共返回 67 个模型，其中包括：

```text
gpt-image-2
gpt-image-1.5-tokyo-cpa-canary
grok-imagine-image
qwen-image-2.0
wan2.7-image
```

随后使用官方 `image_gen.py` 调用 `gpt-image-2`：

- 单张生成成功；
- 低质量方图耗时 18.3 秒；
- Python CLI 自动解码并写入 PNG。

接着发起 5 个不同 Prompt，设置 `--concurrency 5`：

| 指标 | 结果 |
|---|---:|
| 并发任务 | 5 |
| 成功 | 5 |
| 失败 | 0 |
| 单任务耗时 | 19.9～33.2 秒 |
| 5 项累计耗时 | 约 144 秒 |
| 实际墙钟时间 | 34 秒 |

5 个任务同时进入 `starting`，最后全部成功。

如果是串行执行，总时间应该接近 144 秒；实际只用了 34 秒，说明 CLI 的并发不是摆设。

不过测试也发现一个兼容性偏差：请求 `1024×1024`，上游实际返回 `1254×1254`。

这再次证明：**第三方服务能出图，不代表每个参数都与官方完全一致。**

真正投入生产前，至少要验证模型、尺寸、格式、编辑接口、透明背景和并发限制。

---

## 08 出错时，按这张表排查

| 现象 | 更可能的原因 | 怎么处理 |
|---|---|---|
| `401` | Key 无效或没有发送 | 检查 `OPENAI_API_KEY`，立即轮换公开过的 Key |
| `404 /images/generations` | 服务只兼容对话接口 | 换支持 Images API 的入口 |
| 模型列表有 Image 2，但无法出图 | 只有模型名，没有完整端点 | 发一次真实低质量请求验证 |
| Codex 仍调用内置工具 | 没有明确选择 CLI/API 模式 | 写入 `AGENTS.md` 长期偏好 |
| 脚本仍请求官方地址 | 没设置 `OPENAI_BASE_URL` | 在启动 Codex 的环境中注入变量 |
| 返回尺寸不一致 | 第三方做了映射或后处理 | 检查输出，必要时本地缩放 |
| 并发频繁 429 | 上游限流或账户额度不足 | 降低 `--concurrency`，保留重试 |

还有一个现实问题：在 CC Switch 中修改 Codex Provider，并不必然等于修改 Python SDK 的 `OPENAI_BASE_URL`。

前者影响 Codex 的模型请求；后者影响 `image_gen.py` 的图片请求。

如果你要“编程走 A，生图走 B”，这种分离反而是优势。

---

## 09 哪种模式更适合你

如果你有官方 Codex 订阅，偶尔生成一两张图，继续使用内置 `image_gen` 最省事。

如果你需要第三方 API、批量资产、固定输出路径或并发任务，CLI/API 模式更合适。

如果你同时拥有官方订阅和第三方 API，也不需要二选一：

```text
日常单图 → 内置 image_gen
批量生产 → image_gen.py + 第三方 Images API
```

这才是官方 `imagegen` Skill 真正完整的用法。

> 大多数人不是被 Codex 限制了，而是只看见了默认入口，没看见官方已经留好的第二扇门。

最后强调一次：第三方服务至少需要真正兼容 `/v1/images/generations`。只有模型名称，没有接口实现，不算支持。

你现在更愿意用哪种方式？

评论区只打两个词之一：**原生 / API**。

---

## 10 丢给 Agent 解决

不想自己查路径、配环境变量、改长期偏好？把下面这段 Prompt 直接发给 Codex、Claude Code 或其他能操作本机文件和终端的 Agent。

执行前，只需要把两个占位符替换成你的第三方接口地址和 API Key。剩下的检查、配置、单图验证与 5 路并发测试，让 Agent 一次做完。

```text
请帮我完成 Codex imagegen 第三方 API 的永久配置，并实际验证可用性。

我的配置：
- API Base URL：{{第三方 API Base URL，例如 https://example.com/v1}}
- API Key：{{第三方 API Key}}
- 生图模型：gpt-image-2
- 默认并发数：5

请按以下要求执行：
1. 先完整读取本机官方 imagegen Skill 的 SKILL.md，定位其 scripts/image_gen.py；不要凭经验猜路径，也不要改坏系统 Skill。
2. 检查 Python、uv 和 openai SDK 依赖；缺少时只安装必要依赖。
3. 使用安全、长期有效的方式配置 OPENAI_BASE_URL 与 OPENAI_API_KEY；不要把明文 Key 写进项目仓库、AGENTS.md、提交记录或终端输出。
4. 在当前项目 AGENTS.md 中只写入不含密钥的使用偏好：生图优先调用官方 imagegen Skill 自带的 image_gen.py，并使用 gpt-image-2；批量任务默认允许 5 路并发。
5. 先验证模型列表或兼容性，再调用 /v1/images/generations 生成一张低质量测试图；保存到当前项目的 output/imagegen-test 目录。
6. 单图成功后，再提交 5 个不同提示词进行并发测试，并发上限为 5；记录每项成功／失败、耗时、返回尺寸和文件路径。
7. 如果失败，请根据实际响应定位 401、404、429、模型映射、尺寸偏差或端点不兼容问题；不要伪造成功结果。
8. 完成后给我一份简洁报告：修改了哪些配置、密钥保存在哪里、测试证据、以后如何调用、如何撤销配置。报告中必须对 API Key 脱敏。

开始前先说明你发现的 imagegen Skill 路径和准备采用的安全配置方式，然后直接执行；除非涉及覆盖已有配置或需要我授权的高风险操作，否则不要停下来反复询问。
```

这段 Prompt 的关键，不是让 Agent 只写一份教程，而是要求它给出真实测试证据，并且不把密钥写进仓库。

---

作者：ziikoo研究院  
我们专注于企业 AI 基础设施服务。

参考资料：  
OpenAI Codex 官方 imagegen Skill：  
https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md

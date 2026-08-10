# ocx 换掉 cc switch，远离丢会话和重启两大痛

额度快用完了，想从 A 站切到 B 站——于是你打开 cc switch，点了一下切换。

然后客户端重启了。你跑到一半的重构、调试上下文，整个没了。

这是 cc switch 用户最深的痛，不是"有点烦"，是"心碎"。而 ocx 换掉 cc switch，要解决的就是这两件事：

1. 换 provider 丢会话
2. 换模型必须重启客户端

---

## 一、两大痛，先说清楚痛在哪

### 痛一：一切 provider，会话没了

cc switch 的切换动作，本质是改写 CLI 的配置文件 / 环境变量。你点切换，它把 `BASE_URL` 和 Key 换成 B 站那套。

问题在于——客户端读配置是一次性的，读完就缓存进内存。所以配置改了，客户端不会热加载，**必须重启进程，新配置才生效**。

而重启进程，意味着那个活着的 agentic 运行时状态全清零：MCP 连接断了、后台跑着的 bash 没了、内存里的 todo 没了、跑到一半的工具调用没了。你正深入任务、额度正好用完、想换个脑继续干——恰恰这一刻，cc switch 逼你清台重来。

时间点本身就是论点：你换 provider 的时候，就是你最不该被打断的时候。

> 严格说，对话文本不是永久丢。Claude Code 有 `--resume`，Codex 有 thread。但 `--resume` 只能重建对话文本，重建不了活的进程状态——MCP 连接、后台进程、跑到一半的 diff，这些回不来。对正跑长任务的人，丢的是后者，这才是真痛。

### 痛二：换模型，又得重启客户端

同一种痛的另一个面。想从 GPT 换成 Claude 试试、或者 Claude 换成 Grok 省点额度——cc switch 改的还是配置，所以还是得重启客户端，新模型才认。

一天里为了换脑重开三四次客户端，工作流被打成碎片。

---

## 二、为什么 cc switch 必然这样

这两痛不是 cc switch 的 bug，是它的**产品形态决定的**。

cc switch 是一个配置管家：它的全部工作，就是把各套 `BASE_URL`/Key 写进各 CLI 的配置文件，你一切换 = 换配置文件。而"改配置 → 重启 → 进程死 → 状态清零"是一条必然的因果链，只要形态是"改配置"，这条链就躲不掉。

这不是 cc switch 做得差。它是配置切换器，做得再好，也只能优化"切得快不快"，优化不掉"切了得重启"这件事本身。

---

## 三、ocx 怎么做到不痛

ocx（`@bitkyc08/opencodex`，CLI 名 `ocx`）换了个范式：**不是改配置，是跑一个本地代理。**

你的 CLI 永远指向 `localhost:10100` 这个常驻代理。换 provider、换模型，都只是在**代理内部换路由**——客户端进程根本不动，它甚至不知道后台换了脑。

于是：

- 换 provider，**会话不丢**：客户端进程没死，MCP 连接、后台任务、内存里的 todo、跑到一半的工具调用，全活着。ocx 官方把这叫 "history-safe injection"——连聊天历史都不会被重映射，uninstall 都藏不住。
- 换模型，**不用重启**：代理里改路由就行。README 里写 provider 添加完"immediately ready, no restart needed"——添加即生效。

这就是"换脑不搬家"那句叙事的来源：**Codex 当身体，模型当大脑，换脑的时候身体不动。**

---

## 四、顺带还有几把刷子（cc switch 不做的）

一旦范式从"改配置"换成"跑代理"，很多 cc switch 做不到的事自然就来了：

**账号池 / 429 自动切号。** 多个 ChatGPT 账号做池，按 5h / weekly / 30d 配额自动选最低用量的健康号；一个号触发 429，自动冷却、故障转移到池里另一个号。长会话还会 pin 在起头的那个账号上，不会跑到一半跳号。这一条甚至让你**连"手动换 provider"这步都省了**——额度紧，代理自己换。

**Claude 网关发现。** `ocx claude` 把 Claude Code 指向同一个代理，路由的模型会以 `claude-ocx-<provider>--<model>` 的别名出现在 Claude 原生 `/model` 选择器里，自动列出。你不用记模型 ID，在 Claude 里直接选。

**双端一体。** Codex 的 Responses API 和 Claude 的 Messages API，进的是同一个代理。一个本地 daemon，同时喂两端，协议翻译在中间自动做。

---

## 五、一个诚实的边界

不是所有人都该换。cc switch 没死，它在自己的赛道上仍是最好的：

- 你只想**点 GUI 管多套 Key**、不碰协议、看不懂 Responses/Messages 是什么——cc switch 更省心，托盘点一下就切。
- 你要的是 **MCP / Skills 批量管理**、多 CLI 配置一锅炖——cc switch 主打这个，ocx 不碰。
- 你要的是"今天 A 站明天 B 站，点一下启用"那个**切供应商心智**——cc switch 就是为此生的。

但如果你的痛是"一切就丢会话、一换就重启"，而你又愿意接受一个常驻本地代理——那 ocx 是直接对症的解法。

**一句话：cc switch 切的是配置文件，一切就得重开、上下文清零；ocx 切的是请求路由，CLI 永远指本地代理，换脑不搬家，整个工作会话原样保留。**

---

## 六、怎么开始

```bash
npm install -g @bitkyc08/opencodex   # 装
ocx init                              # 写配置 + 注入 Codex
ocx start                             # 起代理，localhost:10100
```

之后 Codex 正常用，请求已经走代理了。Claude 那边用 `ocx claude` 起一个全连线的 Claude Code。

> 仓库：https://github.com/lidge-jun/opencodex
> 文档：https://lidge-jun.github.io/opencodex/
> npm：`@bitkyc08/opencodex`（CLI：`ocx`）

---

*风险提示：ocx 与 cc switch 都非官方工具，经代理使用官方订阅 / 账号存在 ToS 与封号风险，公司代码过本机代理需自行评估；ocx 更新频繁，升级前留意 changelog。*

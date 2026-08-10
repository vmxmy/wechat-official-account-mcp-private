# 微信公众号图文 HTML 语法约束（官方同步）

> **Source of truth**: 微信官方文档
>
> - [公众平台编辑器插件开发规范](https://developers.weixin.qq.com/doc/subscription/guide/product/plugin_spec.html)
> - 结构校验接口：`POST https://mp.weixin.qq.com/article-bin/verify_article_structure`
> - 草稿新增：`add_draft.source.html`（自 [新增草稿](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html)）
> - 发布：`publish.source.html`（自 [发布能力](https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html)）
>
> **Synced at (UTC)**: 2026-07-26T04:10:56Z
>
> **Local raw snapshots**:
>
> - `plugin_spec.source.html`
> - `add_draft.source.html`
> - `publish.source.html`
> - `verify_article_structure.last-response.json`

## 1. 官方结构校验接口

- **URL**: `https://mp.weixin.qq.com/article-bin/verify_article_structure`（文档亦写 http）
- **Method**: POST
- **Body**: `{ "content": "<HTML 字符串>" }`
- **Response**:
  - `isValid: true|false`
  - `inValidInfo`: 按规则分组（height / width / 其他），含 `violateRules` 与违规 `outerHTML`

本地调用示例：

```bash
python3 - <<'PY'
import json, urllib.request
from pathlib import Path
content = Path("article.html").read_text(encoding="utf-8")
req = urllib.request.Request(
    "https://mp.weixin.qq.com/article-bin/verify_article_structure",
    data=json.dumps({"content": content}, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    method="POST",
)
print(urllib.request.urlopen(req, timeout=60).read().decode())
PY
```

## 2. CSS 属性使用规范（必须规避）

来源：官方 plugin_spec §2。

| 规则 | 错误场景 | 影响 |
|------|----------|------|
| opacity | `img` opacity:0 叠 SVG 背景图 | 后台无法改图 |
| caret-color | 透明光标色 | 编辑器光标不可见 |
| line-height | `line-height: 0` | 行重叠 / 可读性差 |
| width | 固定像素宽度（如 `width: 586.438px`） | 破坏响应式，PC/窄屏不一致 |
| height | 固定高度尤其 `height: 0` | 移动端可能整块不可见 |
| text-align | `start` / `end` | 终端兼容不一致 |
| SVG animate begin | 仅 `touchstart` | PC 无法触发 |
| pre | 用 `<pre>` 包普通正文 | 窄屏不换行截断 |

**推荐**: 普通段落用 `<section>` / `<p>`，不用 `<pre>`。

## 3. 文章结构类（不合规会被编辑器删除）

来源：官方 plugin_spec §3。

1. **同标签嵌套 ≤ 15 层**（相同 HTML 标签深度）
2. **`<span leaf>` 仅可含行内元素/文本**，禁止包裹 `section`/`div`/`p` 等块级
3. **`<section nodeleaf>` 仅可包官方指定组件或 `img`**

## 4. 字体使用规范

- **不建议设置任何 `font-family`**
- 平台默认字体栈已覆盖创作端/iOS/Android 一致性
- 自定义 `font-family` 可能在 iOS 17+ 出现字号/字距漂移

默认字体栈（官方）：

```text
font-family: "mp-quote", PingFang SC, system-ui, -apple-system, BlinkMacSystemFont, Helvetica Neue, Hiragino Sans GB, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif;
```

## 5. Dark Mode 要点（官方建议，非硬拦截）

- 文本/背景对比度适中
- 文字背景尽量不用渐变；纯装饰背景可用渐变
- 背景容器 + 多文本节点，不要给每个文本重复写背景
- 避免 absolute 打乱视觉与 DOM 顺序
- 尽量不用图片承载纯文本
- 慎用透明底黑字图
- 不建议 `!important`（影响公共样式与 Dark Mode 覆盖）

## 6. 草稿/发布 API 侧内容约束（摘要）

详见本地 `add_draft.source.html` / `publish.source.html` 字段表。项目侧额外约定：

- 无 JavaScript
- 正文尺寸受微信文档限制
- 样式内联；优先 `section` / `p` / `span` / `strong` / `img`
- 正文图使用 `uploadimg` 返回的 mmbiz URL；封面用永久 `thumb_media_id`
- 上传前跑官方 `verify_article_structure`，报错即 release blocker

## 7. 本仓本地兜底校验

```bash
python3 .agents/skills/gzh-design/scripts/validate_gzh_html.py <file.html>
```

本地脚本覆盖：禁 `style/script/div/class/id`、禁 fixed/absolute/sticky/float/grid/CSS 变量、中文须 `<span leaf>`、半角标点 warning 等。

**官方接口才是最终结构判定**；本地脚本是生成期快速兜底。

## 8. 同步说明

- 本文件从官方文档抽取整理，**冲突时以微信官方页面为准**。
- 更新：`python3 docs/wechat-official/_sync_and_audit.py`

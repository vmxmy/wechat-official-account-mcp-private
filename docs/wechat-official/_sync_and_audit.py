#!/usr/bin/env python3
"""Sync official WeChat HTML constraints and audit a target article HTML."""

from __future__ import annotations

import json
import re
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
ARTICLE = ROOT / (
    "x-to-markdown/wandermist/2080974834851340400/"
    "graph-engineering-the-next-ai-revolution-zh-CN/"
    "translation_排版_石墨极简风(graphite-minimal).html"
)


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def write_constraints_md(synced_at: str) -> Path:
    md = f"""# 微信公众号图文 HTML 语法约束（官方同步）

> **Source of truth**: 微信官方文档
>
> - [公众平台编辑器插件开发规范](https://developers.weixin.qq.com/doc/subscription/guide/product/plugin_spec.html)
> - 结构校验接口：`POST https://mp.weixin.qq.com/article-bin/verify_article_structure`
> - 草稿新增：`add_draft.source.html`（自 [新增草稿](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html)）
> - 发布：`publish.source.html`（自 [发布能力](https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html)）
>
> **Synced at (UTC)**: {synced_at}
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
- **Body**: `{{ "content": "<HTML 字符串>" }}`
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
    data=json.dumps({{"content": content}}, ensure_ascii=False).encode("utf-8"),
    headers={{"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}},
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
"""
    path = OUT / "WECHAT_OFFICIAL_HTML_CONSTRAINTS.md"
    path.write_text(md, encoding="utf-8")
    return path


class Auditor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.same_tag_depth: dict[str, int] = defaultdict(int)
        self.max_same: dict[str, int] = defaultdict(int)
        self.tags: dict[str, int] = defaultdict(int)
        self.font_family = 0
        self.important = 0
        self.fixed_width = 0
        self.fixed_height = 0
        self.lineheight0 = 0
        self.text_align_se = 0
        self.pre = 0
        self.div = 0
        self.position_bad = 0
        self.opacity0 = 0
        self.width_samples: list[str] = []
        self.font_samples: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        style = ad.get("style", "")
        self.tags[tag] += 1
        self.stack.append(tag)
        self.same_tag_depth[tag] += 1
        self.max_same[tag] = max(self.max_same[tag], self.same_tag_depth[tag])

        if tag == "div":
            self.div += 1
        if tag == "pre":
            self.pre += 1
        if re.search(r"font-family\s*:", style, re.I):
            self.font_family += 1
            if len(self.font_samples) < 5:
                m = re.search(r"font-family\s*:\s*[^;]+", style, re.I)
                if m:
                    self.font_samples.append(m.group(0)[:160])
        if "!important" in style:
            self.important += 1
        for m in re.finditer(r"(?<![-\w])width\s*:\s*(\d+(?:\.\d+)?)px", style, re.I):
            self.fixed_width += 1
            if len(self.width_samples) < 8:
                self.width_samples.append(style[:140])
        if re.search(r"(?<![-\w])height\s*:\s*\d+(\.\d+)?px", style, re.I):
            self.fixed_height += 1
        if re.search(r"line-height\s*:\s*0\b", style, re.I):
            self.lineheight0 += 1
        if re.search(r"text-align\s*:\s*(start|end)\b", style, re.I):
            self.text_align_se += 1
        if re.search(r"position\s*:\s*(fixed|absolute|sticky)", style, re.I):
            self.position_bad += 1
        if re.search(r"opacity\s*:\s*0\b", style, re.I):
            self.opacity0 += 1

    def handle_endtag(self, tag: str) -> None:
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i] == tag:
                for t in self.stack[i:]:
                    self.same_tag_depth[t] = max(0, self.same_tag_depth[t] - 1)
                del self.stack[i:]
                break


class DepthMeter(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.max_depth = 0
        self.sec = 0
        self.max_sec = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.depth += 1
        self.max_depth = max(self.max_depth, self.depth)
        if tag == "section":
            self.sec += 1
            self.max_sec = max(self.max_sec, self.sec)

    def handle_endtag(self, tag: str) -> None:
        self.depth = max(0, self.depth - 1)
        if tag == "section":
            self.sec = max(0, self.sec - 1)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    synced_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    sources = {
        "plugin_spec.source.html": (
            "https://developers.weixin.qq.com/doc/subscription/guide/product/plugin_spec.html"
        ),
        "add_draft.source.html": (
            "https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html"
        ),
        "publish.source.html": (
            "https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html"
        ),
    }
    for name, url in sources.items():
        body = fetch(url)
        (OUT / name).write_text(body, encoding="utf-8")
        print(f"saved {name}: {len(body)} bytes")

    write_constraints_md(synced_at)
    print("wrote WECHAT_OFFICIAL_HTML_CONSTRAINTS.md")

    content = ARTICLE.read_text(encoding="utf-8")
    payload = json.dumps({"content": content}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://mp.weixin.qq.com/article-bin/verify_article_structure",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    (OUT / "verify_article_structure.last-response.json").write_text(raw, encoding="utf-8")
    print("official verify:", raw)

    auditor = Auditor()
    auditor.feed(content)
    depth = DepthMeter()
    depth.feed(content)
    leaf_block = len(
        re.findall(
            r"<span[^>]*\bleaf\b[^>]*>[\s\S]*?<(section|div|p|h[1-6]|ul|ol|table)\b",
            content,
            re.I,
        )
    )
    max_same_over = {k: v for k, v in auditor.max_same.items() if v > 15}

    report = {
        "article": str(ARTICLE.relative_to(ROOT)),
        "synced_at": synced_at,
        "official_verify": json.loads(raw),
        "content_chars": len(content),
        "tag_counts": dict(sorted(auditor.tags.items())),
        "max_dom_depth": depth.max_depth,
        "max_section_nest": depth.max_sec,
        "max_same_tag_nest_over_15": max_same_over,
        "div_count": auditor.div,
        "pre_count": auditor.pre,
        "font_family_count": auditor.font_family,
        "font_family_samples": auditor.font_samples,
        "important_count": auditor.important,
        "fixed_width_px_count": auditor.fixed_width,
        "fixed_width_samples": auditor.width_samples,
        "fixed_height_px_count": auditor.fixed_height,
        "lineheight_zero_count": auditor.lineheight0,
        "text_align_start_end_count": auditor.text_align_se,
        "position_fixed_absolute_sticky_count": auditor.position_bad,
        "opacity_zero_count": auditor.opacity0,
        "span_leaf_wraps_block_count": leaf_block,
    }
    (OUT / "html-audit.last-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # Exit non-zero only if official invalid or hard structural breaks
    hard_fail = (
        not report["official_verify"].get("isValid", False)
        or report["div_count"] > 0
        or report["pre_count"] > 0
        or report["position_fixed_absolute_sticky_count"] > 0
        or report["span_leaf_wraps_block_count"] > 0
        or bool(report["max_same_tag_nest_over_15"])
        or report["lineheight_zero_count"] > 0
        or report["text_align_start_end_count"] > 0
    )
    return 1 if hard_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())

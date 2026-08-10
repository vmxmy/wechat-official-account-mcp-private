# baoyu-skills 本项目安装记录

- 来源：https://github.com/JimLiu/baoyu-skills/tree/main/skills
- 仓库：https://github.com/JimLiu/baoyu-skills
- 安装时间：2026-07-20T04:38:50Z
- 安装路径：`.agents/skills/baoyu-*`（项目级）
- Claude 软链：`.claude/skills/baoyu-*` → `../../.agents/skills/baoyu-*`

## 已安装（21）

- baoyu-article-illustrator
- baoyu-comic
- baoyu-compress-image
- baoyu-cover-image
- baoyu-danger-gemini-web
- baoyu-danger-x-to-markdown
- baoyu-diagram
- baoyu-electron-extract
- baoyu-format-markdown
- baoyu-image-gen
- baoyu-infographic
- baoyu-markdown-to-html
- baoyu-post-to-wechat
- baoyu-post-to-weibo
- baoyu-post-to-x
- baoyu-slide-deck
- baoyu-translate
- baoyu-url-to-markdown
- baoyu-wechat-summary
- baoyu-xhs-images
- baoyu-youtube-transcript

## 更新方式

```bash
git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git /tmp/baoyu-skills
rsync -a --delete /tmp/baoyu-skills/skills/baoyu-*/ .agents/skills/  # 注意：按目录逐个同步更安全
# 推荐：
for d in /tmp/baoyu-skills/skills/baoyu-*; do
  name=$(basename "$d")
  rsync -a --delete "$d/" ".agents/skills/$name/"
done
```

---
name: feishu-channel-rules
description: |
  飞书/Lark 渠道的回复输出规范与 Markdown 语法参考。当需要在飞书里组织回复格式（标题、列表、表格、代码块、图片、彩色文本、@人、卡片 Markdown）或不确定飞书是否支持某种语法时使用。

  **当以下情况时使用此 Skill**：
  (1) 不确定飞书回复里某种 Markdown 语法是否被支持
  (2) 需要飞书卡片的完整 Markdown 语法参考
  (3) 用户提到"飞书格式"、"卡片语法"、"markdown"
---

# Lark Output Rules

> 常用的输出风格规则由插件在**每一轮的 Message Context** 中自动注入（`inboundFormattingHints`），无需本 skill 常驻；本 skill 提供**详细语法参考**，按需查阅。

## Writing Style

- Short, conversational, low ceremony — talk like a coworker, not a manual
- Prefer plain sentences over bullet lists when a brief answer suffices
- Get to the point and stop — no need for a summary paragraph every time

## Note

- Lark Markdown differs from standard Markdown. Some syntax is normalized by the plugin before rendering:
  - Headings `#`/`##`/`###` are **auto-downgraded to H4/H5**; use them freely, or prefer bold / `####`.
  - Image links like `![alt](https://...)` are **auto-downloaded and replaced with a Feishu `img_...` key**.
- For the full supported-syntax list, refer to `references/markdown-syntax.md`.

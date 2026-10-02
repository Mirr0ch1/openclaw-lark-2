---
name: feishu-doc
description: |
  飞书云文档操作指引：创建、读取、更新飞书文档，处理文档内的图片/文件/画板，搜索云空间文档，解析 Wiki 链接。

  **当以下情况时使用此 Skill**：
  (1) 需要创建飞书云文档（从 DocxXML 或 Markdown 内容）
  (2) 需要获取文档内容，或下载文档中的图片、文件、画板
  (3) 需要更新文档（追加 / 覆盖 / 定位替换 / 插入 / 删除）
  (4) 需要按关键词搜索云空间文档，或解析 wiki 链接背后是什么类型
  (5) 用户提到"飞书文档"、"云文档"、"docx"、"wiki"、"文档内容"、"改文档"
---

# 飞书云文档（统一走 lark-cli）

飞书云文档的所有操作**统一使用 `lark-cli docs`（v2 API）**。插件内置的 `feishu_create_doc` / `feishu_fetch_doc` / `feishu_update_doc` 工具已停用，不要调用。

## 前置检查：lark-cli 是否可用

飞书 API 操作依赖本机安装的 **lark-cli**。执行任何命令前先确认：

```bash
lark-cli --version    # 命令不存在 = 未安装
```

**若 lark-cli 未安装**：不要退回插件内置的 `feishu_*` 工具（已停用），也不要手写 HTTP 直接调飞书 API。直接告知用户需要先安装并初始化 lark-cli，然后停止本次操作：

```bash
npm install -g @larksuite/cli    # 安装 lark-cli（包名 @larksuite/cli）
lark-cli config init             # 首次配置应用凭证
lark-cli auth login              # 用户身份授权（--as user 场景）
```

认证、身份切换、scope 维护见 `lark-shared` skill。

## 执行前必读

用 Read 读取以下 skill：

- **`lark-shared`** — 认证、`--as user/bot` 身份选择、scope 与权限报错处理
- **`lark-doc`** — 创建/读取/更新的完整命令与格式规范。**`docs +create` / `+fetch` / `+update` 必须携带 `--api-version v2`**；创建/编辑前按 `lark-doc` 的指引读取对应的 `references/`（XML 语法、局部读取、更新工作流）
- **`lark-markdown`** — 需要 Drive 原生 Markdown 文件时使用

## 关键入口

```bash
# 创建（默认 DocxXML，可用 callout/grid/checkbox 等富 block）
lark-cli docs +create --api-version v2 --content '<title>标题</title><p>内容</p>'

# 读取（支持 full/outline/range/keyword/section 局部读取以节省上下文）
lark-cli docs +fetch  --api-version v2 --doc "<文档 URL 或 token>"

# 更新（八种指令：append / overwrite / str_replace / block_insert_after /
#       block_copy_insert_after / block_replace / block_delete / block_move_after）
lark-cli docs +update --api-version v2 --doc "<文档 URL 或 token>" --command append --content '<p>…</p>'

# 文档内媒体
lark-cli docs +media-preview  --doc "<token>" ...   # 预览素材
lark-cli docs +media-download --doc "<token>" ...   # 下载素材 / 画板
lark-cli docs +media-insert   --doc "<token>" ...   # 把本地图片/文件插入文档

# 资源发现（按名称/关键词找文档、表格、Wiki）
lark-cli drive +search --query "关键词"
```

## 本插件上下文补充（lark-cli 之外的知识）

- **Wiki 链接**（`/wiki/TOKEN`）背后可能是 docx / sheet / bitable / slides，**不能假设就是文档**：先用 `lark-cli wiki +node-get` 解析 `obj_type` 与 `obj_token`，再走对应 domain。
- **本地文件导入成云文档**：`lark-cli drive +import --file <path> --type docx|sheet|bitable|slides`。
- **优先局部更新**：图片、画板、电子表格、多维表格等以 token 存储、无法读出后原样写回，改文档时精确定位到纯文本，避开这些区域，慎用 `overwrite`。
- **老的 `docs +search` 已进入维护期**，资源发现统一改用 `drive +search`。

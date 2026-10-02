---
name: feishu-bitable
description: |
  飞书多维表格（Bitable / Base）操作指引：创建与管理多维表格、数据表、字段、记录、视图、公式、lookup、表单、仪表盘。

  **当以下情况时使用此 Skill**：
  (1) 需要创建或管理飞书多维表格 App / 数据表 / 字段 / 视图
  (2) 需要在多维表格中新增、查询、修改、删除记录（行数据）
  (3) 需要做公式字段、lookup、跨表统计、批量导入数据
  (4) 用户提到"多维表格"、"bitable"、"base"、"数据表"、"记录"、"字段"
---

# 飞书多维表格（统一走 lark-cli）

飞书多维表格的所有 API 操作**统一使用 `lark-cli base`**。插件内置的 `feishu_bitable_*` 工具已停用，不要调用。

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

- **`lark-shared`** — 认证、`--as user/bot` 身份选择、scope 与权限报错处理（所有 lark-cli 操作通用）
- **`lark-base`** — Base 的完整命令、字段/记录/视图/公式/lookup 用法；**执行具体命令前先读对应 reference**，字段值结构、单元格值格式、错误码都在其中

## 关键入口

```bash
lark-cli base --help                 # 浏览全部 Base 子命令
lark-cli base +<cmd> --help          # 单个命令的参数
lark-cli schema base.<resource>.<method>   # 无 shortcut 时查原始 API 的字段与 scope
```

常见对应关系（详见 `lark-base`）：

| 任务 | 命令入口 |
|------|---------|
| 建 Base / 建表 | `base +base-create`、`base +table-create` |
| 字段管理 | `base +field-list` / `+field-create` / `+field-update` |
| 记录读写 | `base +record-list` / `+record-get` / `+record-batch-create` / `+record-batch-update` / `+record-delete` |
| 高级查询 | `base +record-search`、`base +data-query`（聚合/筛选/排序 JSON DSL） |
| 视图 / 表单 / 仪表盘 | `base +view-*`、`base +form-*`、`base +dashboard-*` |

## 本插件上下文补充（lark-cli 之外的知识）

- **从 wiki 链接进入**：`/wiki/TOKEN` 背后不一定是 Base，先用 `lark-cli wiki +node-get` 解析 `obj_type`，确认是 `bitable` 后再走 `base`。
- **本地文件导入成 Base**：第一步不是 `base`，而是 `lark-cli drive +import --type bitable`，导入完成后再回到 `base +...`。
- **写记录前**先取字段 `type`/`ui_type`；大批量写要串行并留间隔，避免 `Write conflict`。

---
name: feishu-task
description: |
  飞书任务管理指引：创建、查询、更新任务与任务清单，管理负责人/关注人、子任务、评论、附件、提醒。

  **当以下情况时使用此 Skill**：
  (1) 需要创建、查询、更新任务或标记完成/反完成
  (2) 需要创建、管理任务清单，或把任务加入清单
  (3) 需要设置负责人/关注人/截止时间/提醒、上传附件、加评论
  (4) 用户提到"任务"、"待办"、"to-do"、"todo"、"清单"、"task"
---

# 飞书任务（统一走 lark-cli）

飞书任务的所有操作**统一使用 `lark-cli task`**。插件内置的 `feishu_task_*` 工具已停用，不要调用。

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
- **`lark-task`** — 任务/清单命令与工作流；按需读其 references（`lark-task-create`、`lark-task-update`、`lark-task-tasklist-*` 等）

## 关键入口

```bash
lark-cli task +create              # 创建任务
lark-cli task +update              # 更新任务属性（截止时间、描述等）
lark-cli task +complete / +reopen  # 完成 / 反完成
lark-cli task +get-my-tasks        # 我负责的任务
lark-cli task +get-related-tasks   # 与我相关的任务（我关注的 / 我创建的）
lark-cli task +search              # 按关键词搜索任务
lark-cli task +tasklist-create / +tasklist-task-add / +tasklist-members
lark-cli task +comment / +upload-attachment / +assign / +followers / +reminder
```

## 本插件上下文补充（lark-cli 之外的知识）

- **当前用户**：把消息上下文里的 SenderId（`ou_...`）作为任务成员/负责人，确保创建者本人可查看、可编辑；只有在设置了 `due`（截止时间）时才能设置重复规则和提醒。
- **完成时间**：`+complete` 一般足够；反完成用 `+reopen`。
- **不要混淆**：飞书"审批待办"不是任务，走 `lark-approval`。
- **输出**：把命令返回的 `url`（任务链接）一并给用户，方便点击跳转；渲染负责人/创建人时尽量解析成真实姓名而非只给 open_id。

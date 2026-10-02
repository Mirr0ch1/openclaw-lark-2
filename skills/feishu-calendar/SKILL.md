---
name: feishu-calendar
description: |
  飞书日历与日程操作指引：查看/搜索日程、创建/更新日程、管理参会人、查询忙闲、推荐空闲时段、查询与预定会议室。

  **当以下情况时使用此 Skill**：
  (1) 需要查看、搜索、创建或修改日程 / 会议
  (2) 需要邀请或移除参会人、查询忙闲、推荐空闲时段
  (3) 需要查询或预定会议室
  (4) 用户提到"日程"、"日历"、"会议"、"忙闲"、"会议室"、"约个会"
---

# 飞书日历（统一走 lark-cli）

飞书日历的所有操作**统一使用 `lark-cli calendar`**。插件内置的 `feishu_calendar_*` 工具已停用，不要调用。

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
- **`lark-calendar`** — 日历/日程命令与工作流。**涉及预约会议、或查询/预定会议室时，必须先读其 `references/lark-calendar-schedule-meeting.md`**，不要跳过直接调命令

## 关键入口

```bash
lark-cli calendar +agenda          # 概览今日/近期行程
lark-cli calendar +search-event    # 按关键词/时间/参会人搜索日程
lark-cli calendar +create          # 创建日程，可按需邀请参会人/预定会议室
lark-cli calendar +update          # 更新日程字段，或增删参会人/会议室
lark-cli calendar +freebusy        # 查询忙闲与 RSVP 状态
lark-cli calendar +suggestion      # 时间模糊时智能推荐空闲时段
lark-cli calendar +room-find       # 查找可用会议室
lark-cli calendar +rsvp            # 回复日程邀请（accept/decline/tentative）
```

## 本插件上下文补充（lark-cli 之外的知识）

- **时区固定** `Asia/Shanghai`（UTC+8），时间用带时区的 ISO 8601，例如 `2026-02-25T14:00:00+08:00`。
- **发起人**用当前消息上下文里的 SenderId（`ou_...`）；创建日程时把本人加为参会人，确保本人能看到日程、能回复 RSVP。
- **ID 约定**：用户 `ou_...`，群 `oc_...`，会议室 `omm_...`，外部邮箱 `email@...`。
- **会议室预约是异步的**：返回 `needs_action` 表示预约中，稍后重新查询 `rsvp_status` 确认 `accept`/`decline`。
- 用户口语说的"日历"通常指**日程（Event）**，不是日历容器。

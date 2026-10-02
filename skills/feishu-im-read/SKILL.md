---
name: feishu-im-read
description: |
  飞书 IM 消息读取指引：获取会话历史消息、话题（thread）回复、跨会话搜索消息、下载消息中的图片/文件/音视频。

  **当以下情况时使用此 Skill**：
  (1) 需要获取群聊或单聊的历史消息
  (2) 需要读取话题（thread）内的回复消息
  (3) 需要跨会话搜索消息（按关键词、发送者、时间等条件）
  (4) 消息中包含图片、文件、音频、视频，需要下载
  (5) 用户提到"聊天记录"、"消息"、"群里说了什么"、"话题回复"、"搜索消息"、"图片"、"文件下载"
---

# 飞书 IM 消息读取（统一走 lark-cli）

消息读取的所有操作**统一使用 `lark-cli im`**。插件内置的 `feishu_im_user_*` 工具已停用，不要调用。

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
- **`lark-im`** — 消息/群聊命令与分页、身份说明；按需读其 references（如 `lark-im-chat-messages-list`、`lark-im-messages-search`、`lark-im-messages-resources-download`、`lark-im-threads-messages-list`）

## 关键入口

```bash
# 会话（群聊或单聊）历史消息：--chat-id oc_xxx 或 --user-id ou_xxx（二选一），支持时间范围/排序/分页
lark-cli im +chat-messages-list --chat-id <oc_xxx> --page-size <n>

# 话题内回复
lark-cli im +threads-messages-list --thread-id <omt_xxx>

# 跨会话搜索消息（用户身份）
lark-cli im +messages-search --query "关键词" [--chat-id <oc_xxx>] [--sender-ids <ou_...>] ...

# 批量按 ID 取消息
lark-cli im +messages-mget --message-ids <om_xxx,om_yyy>

# 下载消息中的图片/文件/音视频
lark-cli im +messages-resources-download --message-id <om_xxx> --file-key <img_xxx|file_xxx> ...
```

## 本插件上下文补充（lark-cli 之外的知识）

- **身份选择**：读"用户自己的"消息用 `--as user`（受该用户自身权限限制）；群管理/机器人视角用 `--as bot`。
- **chat_id 与 open_id**：`oc_...` 是会话 ID；`ou_...` 是用户 open_id（用于取与某人的单聊）。消息上下文中出现的 SenderId 即 `ou_...`。
- **分页**：返回 `has_more=true` 时用 `page_token` 继续取；`page_size` 上限 50。
- **资源下载**：单文件上限 100MB；不支持表情包、卡片内的资源。
- **话题消息不支持时间过滤**（飞书 API 限制），只能分页取。

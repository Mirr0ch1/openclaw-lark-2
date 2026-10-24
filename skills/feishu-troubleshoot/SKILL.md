---
name: feishu-troubleshoot
description: |
  飞书插件（渠道）自身的问题排查指引：渠道消息收发异常、卡片交互异常的 FAQ，以及深度诊断命令（/feishu doctor）。

  **当以下情况时使用此 Skill**：
  (1) 飞书渠道里机器人收发消息 / 卡片交互异常
  (2) 需要检查插件账户配置、API 连通性、应用身份与用户授权状态
  (3) 用户提到"飞书插件排查"、"飞书 doctor"、"卡片按钮没反应"
---

# 飞书插件（渠道）问题排查

> 本 skill 只覆盖**插件/渠道自身**的排障。飞书业务操作（文档、表格、任务、日历等）见 `feishu-cli` skill。

## 快速体检命令

| 命令 | 作用 |
|---|---|
| `/feishu doctor` | 账户配置 / API 连通性 / 应用权限 / 用户授权 |
| `/feishu larkcli status` | **账号 → lark-cli profile 映射**（含 appId 漂移、token 状态、用的是哪个 profile 存储） |
| `/feishu larkcli sync` | 重建/修复 profile（凭证缺失会自动补） |
| `/feishu diagnose` | 深度诊断报告 |

**"模型说找不到飞书能力"**：插件只保留 15 个工具（`feishu_auth`、chat/wiki/drive/sheets 读写等），文档/表格/任务/日历一律走 `feishu-cli` skill + `bin/feishu-lark`。先确认 `lark-cli --version` 可用，再跑 `/feishu larkcli status` 看映射是否就绪。

## FAQ：卡片按钮点击无反应

**现象**：点击卡片按钮无反应，随后提示报错。

**原因**：应用未开通「消息卡片回传交互」权限。

**解决步骤**：

1. 登录飞书开放平台：https://open.feishu.cn/app
2. 选择你的应用 → **事件与回调**
3. 把订阅方式改为「长连接」，并添加回调 `卡片回传交互`（`card.action.trigger`）
4. 创建应用版本 → 提交审核 → 发布

## 诊断命令：`/feishu doctor`

**何时使用**：多次授权仍失败、自动授权流程解决不了、需要查看完整权限配置状态时。常规权限问题会自动触发授权流程，无需手动诊断。

**用法**：在飞书聊天会话中直接发送（作为用户消息）：

```
/feishu doctor
```

**诊断内容**：

- **诊断摘要**：总体状态（✅ 正常 / ⚠️ 警告 / ❌ 失败）、发现的问题列表
- **环境信息**：插件版本
- **账号信息**：凭证完整性（appId / appSecret 掩码）、账户启用状态、API 连通性、Bot 信息
- **应用身份权限**：已开通/缺失的必需权限，一键申请链接
- **用户身份权限**：授权状态统计、Token 自动刷新状态（是否含 `offline_access`）、权限对照表

> 认证身份选择、scope 维护、`Permission denied` 报错处理等**通用 lark-cli 问题**，统一见 `lark-shared` skill，本 skill 不再重复。

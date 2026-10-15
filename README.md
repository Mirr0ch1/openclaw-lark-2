<div align="center">

# openclaw-lark-2

**OpenClaw 2.0 原生飞书 / Lark 渠道插件**

`@larksuite/openclaw-lark` 的独立分支，面向 OpenClaw 2.0 SDK 全面适配。

[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.8.1-3b82f6?style=flat-square)](#安装)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-448%20passing-22c55e?style=flat-square)](#开发)
[![ClawHub](https://img.shields.io/badge/ClawHub-%40mirr0ch1%2Fopenclaw--lark--2-8b5cf6?style=flat-square)](https://clawhub.ai)

[English](./README.en.md) · **中文**

</div>

---

## 目录

- [为什么有这个分支](#为什么有这个分支)
- [特性](#特性)
- [安装](#安装)
- [配置](#配置)
- [三方对比](#三方对比)
- [更新日志](#更新日志)
- [开发](#开发)
- [致谢与许可](#致谢与许可)

---

## 为什么有这个分支

OpenClaw 2.0（2026.8.1）重构了插件 SDK：

- 移除了裸 `openclaw/plugin-sdk` 导出，重命名了多个子路径；
- 会话存储从 JSON 迁移到 SQLite；
- 渠道能力（如持久化最终投递 `durableFinal`）成为显式契约。

官方 `@larksuite/openclaw-lark` 未跟进，在 2.0 下**无法加载**，卡片 footer 指标也随之消失。本分支针对 2.0 SDK 全面适配，开箱即用。

---

## 特性

### 架构与兼容

- **OpenClaw 2.0 原生适配**：SDK 导入路径、类型、运行时 API 全部对齐 2026.8.1。
- **多账号**：一个 OpenClaw 实例同时接入多个飞书应用。

### 消息与交互

- **流式卡片（CardKit）**：群聊与私聊同体验，`channels.feishu.replyMode.group: "streaming"`。
- **工具调用动态展示**：实时展示 agent 正在调用的工具步骤，默认开启。
- **内置 `ask_user` 按钮卡片**：问题渲染为带选项按钮的交互卡片，支持“其他答案”输入表单；群聊中所有成员均可交互。
- **多图合并为一条富文本 post**：一次发送 ≥2 张图片时默认合并为**一条** post（飞书无相册 API，每张图一个段落）；`multiImageMode: "sequential"` 可回退逐张，任一上传失败自动回退，不丢图。
- **完整 footer 指标（7 项）**：状态 · 耗时 · model · **provider** · tokens · cache · context（`provider` 为本分支新增）。
- **PIN 消息操作**：内置 message 工具新增 `pin` / `unpin` / `list-pins`。

### 传输与可靠性

- **Webhook 双通道**：`connectionMode: "webhook"` 使用飞书回调（签名校验 `sha256(timestamp+nonce+encryptKey+body)`、时间偏移上限、`url_verification` challenge 应答、请求体大小/超时与并发前置守卫）。默认仍为 WebSocket。
- **持久化入站队列（可选）**：`durableIngress: true` 把 `im.message.receive_v1` / 文档评论事件投进宿主的持久队列，按会话 lane 保序、区分可重试/永久错误。未开启时与旧行为逐字一致。
- **发送限流重试**：统一识别 HTTP 429 与业务码 `230020` / `11232`（含"HTTP 200 但 body 是限流码"），覆盖文本 / 卡片 / 媒体 / 转发等全部 IM 发送点。
- **每会话队列超时**：单条 dispatch 默认 5 分钟上限，超时任务继续运行但不再阻塞同会话后续消息（上游 #70133）。
- **重投递稳定去重**：text/post 按 `sender + chat + create_time + 内容哈希` 去重，飞书换 `message_id` 重投也能识别（上游 #46778）。
- **信封感知分页**：超过 30KB 的富文本 post 按**序列化后字节数**自适应切分，而非仅按字符数（中文 15000 字符 ≈ 45KB）。

### 安全与工程

- **读权限策略（对齐官方 read-policy）**：工具读取受策略约束 —— **当前会话始终可读**；跨群读取按 `groupPolicy`（`disabled` 连当前群也拒绝）；**跨私聊读取需 `allowFrom` 含 `*`**。作用于 `feishu_chat.get` 与 `feishu_chat_members`（私聊仅返回当前发送者）。
- **全量 SSRF 防护**：所有出站 HTTP 请求统一走 SDK `fetchWithSsrFGuard` —— DNS pinning 防 rebinding、IPv4+IPv6 私有/保留地址阻断、重定向逐跳校验、hostname 白名单。
- **工具结果围栏**：模型可见的工具输出统一包 `EXTERNAL_UNTRUSTED_CONTENT` 标记，防文档/消息中的提示注入；失败时附带 `http_status` / `feishu_code` / `feishu_msg` / `feishu_log_id`。
- **原生卡消毒**：模型自建卡片在发送前做元素白名单、按钮 URL 仅允许 http(s)、callback value 门禁与文本转义。
- **诊断 hook fail-safe**：`before_tool_call` / `after_tool_call` 在 OpenClaw 中是 **fail-closed** —— 插件 hook 抛一次异常就会阻断**整个**工具调用（不区分工具）。本插件的两个 hook 全程 `try/catch` + 防御式字段读取，只写日志、**永不阻断**工具链路。
- **测试基座**：vitest 测试套件（`npm test`），覆盖核心安全与路由路径。
- **Plugin Inspector 报告**：`clawhub package validate` 0 warning。

### 多账号与工具

- **按调用指定账号**：全部工具支持可选 `accountId` 参数，多账号部署时可定向到指定账号；显式账号未配置/被禁用会**明确报错**而非静默回退到首个账号。
- **配置信号**：manifest 声明 `toolMetadata.configSignals`，未配置 `appId`/`appSecret` 时宿主按工具隐藏，避免无效调用。

### 内置 Skills

插件自带一组飞书 skill，全部**以 `lark-cli` 为唯一操作入口**（字节已用 `lark-cli` 取代插件内置的 `feishu_*` 工具）：

- `feishu-doc` / `feishu-bitable` / `feishu-calendar` / `feishu-im-read` / `feishu-task` —— 指向对应 `lark-cli <domain>` 与官方 `lark-*` skill；执行前检查 lark-cli 是否安装，缺失时提示安装 `@larksuite/cli`，**不回退**已停用的内置工具。
- `feishu-channel-rules` —— Lark 卡片 Markdown 语法参考；常用格式规则由插件**每轮自动注入**，无需常驻。
- `feishu-troubleshoot` —— 插件 / 渠道自身排障（卡片回传权限 FAQ、`/feishu doctor`）。

---

## 安装

### 通过 ClawHub

```bash
openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2
```

### 通过 tarball（本机开发）

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.10.8.tgz
```

---

## 配置

插件注册 `feishu` 渠道，与官方版共用 `channels.feishu` 配置结构。

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",

      // 多账号示例
      accounts: {
        plaud: { appId: "cli_yyy", appSecret: "yyy", dmPolicy: "pairing" },
      },

      // footer 七项全开（provider 为新增项）
      footer: {
        status: true,
        elapsed: true,
        model: true,
        provider: true,
        tokens: true,
        cache: true,
        context: true,
      },

      // 多图合并：post（默认，多条图合为一条）/ sequential（逐张发送）
      multiImageMode: "post",

      // 群聊与私聊均用流式卡片
      replyMode: { group: "streaming" },

      // 传输：websocket（默认）| webhook（飞书回调）
      connectionMode: "websocket",

      // 可选：入站事件进宿主持久队列（默认 false，开启后按会话保序、重启不丢）
      // durableIngress: true,

      // 可选：无显式 accountId 时的路由偏好（不会启用被禁用的账号）
      // defaultAccount: "plaud",
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> **权限提示**：飞书应用需在开放平台开通 `cardkit:card:write` 权限，流式卡片才能生效。
>
> **读权限**：`feishu_chat.get` / `feishu_chat_members` 受读策略约束。读取**非当前**私聊需要该账号的 `allowFrom` 含 `"*"`（注意这同时会放宽私聊**入站**准入）；跨群读取按 `groupPolicy`，账号 `groupPolicy: "disabled"` 时连当前群也不可读。消息历史读取工具（`feishu_im_user_get_messages` 等）不受此策略影响。

---

## 三方对比

本插件在设计上**取两家之长**：以字节 `@larksuite/openclaw-lark` 的完整工具面为基础，吸收官方 `@openclaw/feishu` 的 OpenClaw 2.0 原生架构与安全工程，再补齐两家都没有的短板。

| 维度 | **openclaw-lark-2（本插件）** | **@openclaw/feishu（官方 2.0）** | **@larksuite/openclaw-lark 7.16（字节）** |
|---|:---:|:---:|:---:|
| 版本 | **2026.10.8** | 2026.8.1 | 2026.7.16 |
| OpenClaw 兼容 | **≥2026.8.1（2.0 原生）** | ≥2026.8.1（2.0 原生） | ≥2026.5.4（1.x，2.0 下无法加载） |
| Plugin API | 2.0 SDK（`runtime.config.current()`） | 2.0 SDK（`createChatChannelPlugin`） | 1.x API（`loadConfig`，已废弃） |
| 契约工具数 | **38** | 14 | 39 |
| calendar / task / sheets | ✅ | ❌ | ✅ |
| im 收发 / 搜索工具 | ✅ 6 | ❌（走 channel action） | ✅ 6 |
| 入站消息转换器 | **22 种** | 部分 | 22 种 |
| 流式回复（CardKit） | ✅ 群聊 + 私聊 | ✅ | ✅（须开 `streaming:true`） |
| 多图合并 post | ✅ **默认一条 post** | ❌ 仅逐张 | ❌ 仅逐张 |
| 群聊流式卡片 | ✅ `replyMode.group:"streaming"` | ✅ | ❌ 群聊默认 static |
| 工具动态展示 | ✅ **默认开启** | ⚠️ 仅 verbose/preview | ⚠️ 依赖 verbose（默认 off） |
| 内置 `ask_user` 按钮 | ✅ **按钮卡片 + “其他答案” + 群聊全员可交互** | ❌ 仅文本回退 | ❌ 用自家 `feishu_ask_user_question` |
| PIN 消息操作 | ✅ `pin`/`unpin`/`list-pins` | ✅ | ❌ |
| SSRF 防护 | ✅ **全量出站**（DNS pinning + 私网阻断 + 重定向校验 + hostname 白名单） | ✅ 仅 CardKit / 注册请求 | ⚠️ 手写 IPv4-only 检查 |
| 输入中指示 | ✅ reaction 式 | ✅ reaction 式 | ✅ reaction 式 |
| reactions / 文档评论 | ✅ | ✅ | ✅ |
| OAuth device-flow | ✅ | ❌（仅 app 注册向导） | ✅ |
| Webhook 双通道 | ✅ **WS + webhook（webhook 可选）** | ✅ WS + webhook | ❌ |
| 持久化入站队列 | ✅ **可选（`durableIngress`）** | ✅ 默认启用 | ❌ |
| 读权限策略 | ✅ 对齐官方 | ✅ | ❌ |
| 按调用指定账号 | ✅ 全工具 `accountId` | ✅ | ❌ |
| 测试套件 | ✅ **vitest 基座（59 文件 / 448 用例）** | ✅ 99 文件 / 1202 用例 | ❌ 无 |
| 安全审计 | ✅ plugin-inspector 报告 | ✅ security-audit + SSRF | ⚠️ 无 |

### 取长补短的思路

1. **工具面 = 字节 7.16 全家桶**：38 个工具覆盖 im / doc / wiki / drive / bitable / calendar / task / sheets / search / oauth；官方 2.0 只有 14 个。唯一移除的是字节自研 `feishu_ask_user_question`（已被内置 `ask_user` 按钮渲染取代）。
2. **架构 = 官方 2.0 原生适配**：完整使用 OpenClaw 2.0 SDK；字节 7.16 因用 `loadConfig` 在 2.0 下直接无法加载。
3. **交互增强（两家都没有）**：内置 `ask_user` 按钮卡片；工具动态展示默认开启；PIN 消息操作。
4. **安全补强（取官方）**：`fetchWithSsrFGuard` 应用到**全部**出站请求；官方仅用于 CardKit 与 app 注册，字节只有手写 IPv4 检查。
5. **工程化补强（取官方）**：建立 vitest 测试基座，并保留 plugin-inspector 安全报告。

### 已知差异

| 项 | 说明 |
|---|---|
| Webhook 传输 | 已支持，且为**可选**（`connectionMode: "webhook"`），默认仍走 WebSocket。 |
| 持久化入站队列 | 已支持但**默认关闭**（`durableIngress: true` 开启）；官方默认启用。开启后行为与原 WS 直派发一致，但获得按会话保序与重启存活。 |
| 读权限策略 | 已对齐官方语义；由于本插件工具无宿主上下文，读上下文从**当前消息 ticket** 还原，因此在 cron/heartbeat 等无消息上下文时，跨私聊读取按策略被拒。 |
| PIN 消息 | 本插件已支持；字节 7.16 无。 |
| 测试规模 | 本插件为最小基座（59 文件 / 448 用例），远小于官方（1202），但覆盖核心安全与路由路径。 |
| 工具展示开关 | `toolUseDisplay.enabled:false` 可关，默认开。 |

---

## 更新日志

<details open>
<summary><b>2026.10.8</b> · 2026-10-15 · 可靠性加固（对比官方逐项对齐）+ 入站 debounce 合并</summary>

以官方 `@openclaw/feishu` 为参照，对插件自身代码做了一轮系统的健壮性加固（A / B / C 三批 + 若干修复），并移植入站 debounce 合并。

**可靠性修复（A 批 / S1）**

- **webhook 崩溃**：修复 webhook 路径上的 `ReferenceError`。
- **出站 code 断言**：出站错误码断言不再误判。
- **流式配置**：`streaming` 配置 schema 与运行时对齐。
- **多账号 / 目标解析**：accounts 与 targets 解析修复（含 `lark:` / `group:` / `channel:` / `dm:` 前缀与 tag 感知）。
- **pending-history key**：群聊待处理历史键对齐官方 `groupHistoryKey`（去掉 `:thread:` 后缀）——修复 `threadSession` 下「root_id 推断线程」导致历史桶读写不一致、上下文被静默丢弃的问题。

**可靠性修复（B 批）**

- **reaction 访问门禁**：reaction 事件在派发前补上访问门禁校验（安全）。
- **撤回回复回退**：回复目标已撤回时自动回退为新建消息（对齐官方 `sendReplyOrFallbackDirect`）。
- **groupSessionScope 入站落地**：`group` / `group_sender` / `group_topic` / `group_topic_sender` 会话作用域在入站生效。
- **交互去重键**：卡片交互按 `event_id` / `token` 去重（重试稳定）。
- **abort 快路径键**：中断快路径的队列键与派发键对齐。

**可靠性修复（C 批）**

- **`onDeliveryResult` 透传**：出站适配器把每次物理发送的结果回传给核心（部分投递 / 子代理完成追踪）；回调异常只记日志，不影响已发送结果。
- **去重持久化**：入站去重改用宿主 `openclaw/plugin-sdk/persistent-dedupe`（SQLite）并采用 **claim / commit / release** 语义 —— 重启不再重复处理；commit 在「消息入队 / 采纳之后」，崩溃不会永久吞掉重投递。TTL 对齐官方 24h。
- **mention 注册表上限**：name→openId 注册表按「每群 500 / 全局 500」双向封顶（LRU 刷新），不再无界增长。
- **出站媒体上限 + 失败传播**：出站媒体强制 `min(mediaMaxMb, 30MB)`（远端流式读取超限即中止，内存有界）；`mediaMaxMb` schema 要求正数；直接 `send` 附件上传失败改为显式报错（#112244），渠道级回复仍保留文本链接降级。

**入站 debounce 合并（P3-A6，可选）**

- 核心配置 `messages.inbound.debounceMs`（默认 0 = 关）。开启后，同一 `(账号 / 会话 / 话题 / 发送者)` 在安静窗口内的连续**文本**消息合并为**一条**再触发一次 agent 回合（控制命令不合并），减少刷屏并让上下文更完整。
- 与 `durableIngress` 联动：按 `event_id` 把耐久入站行的生命周期传给处理器，flush 完成前不墓碑化 —— **debounce 窗口内崩溃也不丢消息**（对齐官方 `buildFeishuFlushIngressLifecycle`）。

**最终复核（对齐官方 main `c36af74`）**

- **`replyInThread` 配置类型**：schema 与运行时不一致（schema 为 boolean，运行时按官方字符串枚举 `"enabled"` 比较），导致布尔 `true` 静默失效、官方写法 `"enabled"` 校验失败。现同时接受两者并统一归一化。
- **allowlist 前缀**：`feishu:` / `lark:` / `user:` / `open_id:` 等前缀条目此前被静默拒绝，现按官方归一化。
- **`@all` 识别**：放宽为官方的 `@all` / `@_all` 键 + `id.* === "all"`（原先仅 `@_all`）。
- **reaction / 文档评论派发**：补上 `botOpenId`（此前群系统提示 / 身份字段 / bot-peer 提及解析为空）。
- **媒体回退链接**：上传失败回退为文本链接前先做 SSRF 校验（仅公网 http(s) 才回显，否则发通用失败提示），对齐官方 `resolvePublicFeishuMediaReference`。
- **移除死代码**：删除从未接入且宿主已移除 `OnboardingAdapter` 契约的 onboarding 适配器（3 模块）与 `agent-config` 模块。

**测试**：30 文件 / 226 用例 → **59 文件 / 448 用例**。

</details>

<details>
<summary><b>2026.10.6</b> · 2026-10-14 · 诊断 hook 加固：绝不 fail-close 工具链路</summary>

`before_tool_call` 在 OpenClaw 中是 **fail-closed**：插件 hook 一旦抛异常，**整个工具调用**会被阻断 —— 而且**不区分工具**。本插件的这两个 hook 只做调用追踪与日志，不该具备这种破坏力。

**修复**

- `before_tool_call` / `after_tool_call` 两个诊断 hook 现在**整段包 `try/catch`**：任何异常降级为一条 `log.warn` 并放行，**永不阻断工具调用**。
- hook 事件字段全部防御式读取（`event?.toolName ?? ''`、`ctx?.sessionKey`），对宿主契约变化免疫。

**排查提示**

> 热更新插件（`plugins install` / `plugins reload`）后，若**所有** cron / 无头任务的工具调用被阻断，且日志出现
> `before_tool_call hook failed: … PluginInstanceUnavailableError: Plugin openclaw-lark-2 was reloaded or disabled; use its current tools.`
> —— 那是宿主在 **drain 超时**后残留了**上一代插件实例的 hook**，与本插件的代码无关。
> 执行 `openclaw plugins reload openclaw-lark-2` 清除（无效时重启网关）；交互会话通常不受影响。

**测试**：30 文件 / 226 用例。

</details>

<details>
<summary><b>2026.10.5</b> · 2026-10-14 · 对齐官方 <code>@openclaw/feishu</code>：可靠性原语 · 读权限 · 多账号路由</summary>

以官方插件（openclaw `main` `2f620b9`，2026-10-12）为参照，移植其更成熟的工程原语，并补齐多账号与读权限。**新能力多为可选或对既有行为无影响**，其中读权限是唯一的有意收紧。

**可靠性**

- **工具结果围栏 + 结构化错误**：模型可见输出统一包 `EXTERNAL_UNTRUSTED_CONTENT`，错误附带 `http_status`/`feishu_code`/`feishu_msg`/`feishu_log_id`。
- **发送限流统一重试**：429 与 `230020`/`11232`（含"200 但 body 是限流码"），覆盖全部 IM 发送点。
- **每会话队列超时**：单条 dispatch 默认 5 分钟上限，超时不再阻塞同会话后续（#70133）。
- **重投递稳定去重**：text/post 按 `sender+chat+create_time+内容哈希`（#46778）。
- **原生卡消毒**：元素白名单 + 按钮 URL 仅 http(s) + callback value 门禁 + 文本转义（仅作用于模型自建卡）。
- **探针错误缓存 1 分钟 + 目录分页护栏**；**富文本 post 按 30KB 序列化字节自适应切分**。

**传输与投递**

- **Webhook 传输**（`connectionMode: "webhook"`，可选）：签名校验 + 时间偏移上限 + challenge 应答 + 请求体/并发前置守卫。
- **持久化入站队列**（`durableIngress: true`，默认关）：宿主队列 + 按会话 lane 保序 + 可重试/永久错误分类。
- **发送权威**：被 retire/abort 的回合在发送前抛 `PlatformMessageNotDispatchedError`（`retryable:false`），不再发出陈旧消息。

**多账号与读权限**

- **按调用指定账号**：全部工具支持可选 `accountId`；显式账号未配置/被禁用会明确报错，不再静默回退到首个账号。
- **读权限策略**（对齐官方）：`feishu_chat.get` / `feishu_chat_members` 受策略约束 —— 当前会话可读；跨群按 `groupPolicy`；**跨私聊需 `allowFrom` 含 `*`**。
- **配置信号**：manifest `toolMetadata.configSignals`，未配置凭据时按工具隐藏。

**其他**

- **文档评论 typing 反应**：评论事件没有 IM 消息可挂"输入中"指示，改为在评论回复上加 `Typing` 反应、回合结束后移除（`typingIndicator: false` 可关）。
- **`openclaw doctor --fix` 配置修复**：新增包根 `doctor-contract-api`，可自动把 `channels.feishu[.accounts.<id>].webhookPath` 规范化（命名账号按账号派生路径，避免与默认账号撞路由）。

**修复**：`config-schema` 补齐 `durableIngress` / `defaultAccount` / `typingIndicator`；修掉 `config-schema.d.ts` 里 `accounts` 形态重复的 `multiImageMode`；`.d.ts` 与运行时同步。

**测试**：15 文件 / 128 用例 → **30 文件 / 226 用例**；`clawhub package validate` 通过。

</details>

<details>
<summary><b>2026.10.3</b> · 2026-10-03 · 内置 Skills 重构为 lark-cli 薄指针 + 渠道格式规则常驻</summary>

内置 skill 全面重构为以 `lark-cli` 为唯一操作入口：`feishu-create-doc` / `feishu-fetch-doc` / `feishu-update-doc` 合并为 `feishu-doc`（原三者引用的 `feishu_mcp_*` 工具名早已失效）；`feishu-bitable` / `feishu-calendar` / `feishu-im-read` / `feishu-task` 改为指向对应 `lark-cli <domain>` 与官方 `lark-*` skill，仅保留渠道特有知识。新增「lark-cli 缺失」兜底提示（引导安装 `@larksuite/cli`，而非回退已停用工具）。修复 `feishu-channel-rules` 的失效 `alwaysActive` 字段——改为通过 `agentPrompt.inboundFormattingHints` **每轮注入** Lark 卡片格式规则；更正标题自动降级、图片 URL 自动转 key 两处过时说明。skill 体积 4803 → 538 行。（15 文件 / 128 用例）

</details>

<details>
<summary><b>2026.10.2</b> · 2026-10-03 · 文档：README 拆分为中文（默认）与英文</summary>

README 拆为两个文件：`README.md`（中文，默认）与 `README.en.md`（English）；修正 ClawHub 安装命令为 `openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2`。无代码变更。

</details>

<details>
<summary><b>2026.9.20</b> · 2026-10-03 · 修复默认账号下群聊命令被判未授权</summary>

`getLarkAccount` 当 `accountId === 'default'` 时会整个跳过 `accounts.default` 覆盖，导致写在该账号条目里的 `allowFrom / groupAllowFrom / dmPolicy / groupPolicy` 被丢弃（core 的 `resolveFallbackAccountConfig` 会读这些字段，插件不读 → 两边解释不一致）。私聊靠 pairing allow-from store 兜住所以正常；群聊不读 store 又丢了 `groupAllowFrom` → 插件算出 `CommandAuthorized=false`，于是 `/new`、`/reset` 等 owner 级命令被 core 静默拒绝（`Ignoring /new from unauthorized sender`），不 reset 也不产生可见回复，只回通用兜底文案。现在 default 账号的显式覆盖会像其它账号一样被合并。新增 6 条账号回归测试（14 文件 / 126 用例）。

</details>

<details>
<summary><b>2026.9.19</b> · 2026-09-19 · 修复长任务回复丢失</summary>

终端卡片整卡更新撞飞书硬上限（>200 元素 300305 / >30KB 200860）时失败被吞，用户只看到卡住的流式卡片（实测 61 次工具调用 → 310 元素）；现在终端卡片按硬上限自适应降级（工具步骤折叠为“其余 N 步未展示”、reasoning 面板裁切/丢弃、工具输出截断、必要时裁正文），并在**卡片更新失败或正文被裁切时自动以纯文本补发完整回复**。另：流式模式被飞书 10 分钟上限自动关闭（300309）后不再静默丢消息（原“回退 `im.message.patch`”对 CardKit 卡片是空操作）。新增 17 条卡片预算/兜底单测（13 文件 / 120 用例）。

</details>

<details>
<summary><b>2026.9.6</b> · 2026-09-06 · 修复多账号入站消息静默丢弃</summary>

修复 OpenClaw 2.0 多账号下入站消息全部静默丢弃（`PreparedModelCatalogConfigReplacedError`）：核心调度改用未被篡改的全局 config + `usePublishedModelRuntime`（PR #1，by leothebravest）；补齐 comment / reaction / VC 邀请三条链路的 config 透传，并阻断 `config.current()` 返回空对象导致的 `cfg: {}` 派发；新增 6 条派发配置单测（11 文件 / 103 用例）。

</details>

<details>
<summary><b>2026.9.4</b> · 2026-09-03 · 多图合并为一条富文本 post</summary>

新增 `channels.feishu.multiImageMode`（默认 `post`，`sequential` 回退逐张；任一上传失败自动回退）。（10 文件 / 97 用例）

</details>

<details>
<summary><b>2026.9.3</b> · 2026-09-02 · SSRF 防护 · PIN 操作 · 测试基座</summary>

SSRF 防护全量落地、PIN 消息操作、vitest 测试基座（9 文件 / 78 用例），全量安全测试通过。

</details>

<details>
<summary><b>2026.9.2</b> · 2026-09-01 · ask_user 修复 · 群聊流式</summary>

修复 ask_user “其他答案”提交；移除 `feishu_ask_user_question`；群聊流式卡片；工具 dry-run 脚本。

</details>

<details>
<summary><b>2026.9.1</b> · 2026-09-01 · OpenClaw 2.0 兼容修复</summary>

OpenClaw 2.0 兼容修复、内置 ask_user 按钮渲染、工具动态展示、ClawHub 发布。

</details>

<details>
<summary><b>2026.8.1</b> · 2026-08-31 · 初始 2.0 适配分支</summary>

初始 2.0 适配分支。

</details>

---

## 开发

```bash
npm install            # 安装依赖（含 vitest）
npm test               # 运行 vitest 测试套件
npm run test:watch     # 测试监听模式
```

插件为 CommonJS 源码（`src/` + `index.js` 入口），无构建步骤；改动后同步到 OpenClaw 扩展目录并重启网关即可生效。

---

## 致谢与许可

基于 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）二次开发，保留 MIT 许可。

<div align="center"><sub>openclaw-lark-2 · OpenClaw 2.0 · 飞书 / Lark</sub></div>

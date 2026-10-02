<div align="center">

# openclaw-lark-2

**OpenClaw 2.0 原生飞书 / Lark 渠道插件**

`@larksuite/openclaw-lark` 的独立分支，面向 OpenClaw 2.0 SDK 全面适配。

[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.8.1-3b82f6?style=flat-square)](#安装)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-128%20passing-22c55e?style=flat-square)](#开发)
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

### 安全与工程

- **全量 SSRF 防护**：所有出站 HTTP 请求统一走 SDK `fetchWithSsrFGuard` —— DNS pinning 防 rebinding、IPv4+IPv6 私有/保留地址阻断、重定向逐跳校验、hostname 白名单。
- **测试基座**：vitest 测试套件（`npm test`），覆盖核心安全与路由路径。
- **Plugin Inspector 报告**：`clawhub package validate` 0 warning。

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
openclaw plugins install openclaw-lark-2-2026.10.3.tgz
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
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> **权限提示**：飞书应用需在开放平台开通 `cardkit:card:write` 权限，流式卡片才能生效。

---

## 三方对比

本插件在设计上**取两家之长**：以字节 `@larksuite/openclaw-lark` 的完整工具面为基础，吸收官方 `@openclaw/feishu` 的 OpenClaw 2.0 原生架构与安全工程，再补齐两家都没有的短板。

| 维度 | **openclaw-lark-2（本插件）** | **@openclaw/feishu（官方 2.0）** | **@larksuite/openclaw-lark 7.16（字节）** |
|---|:---:|:---:|:---:|
| 版本 | **2026.10.3** | 2026.8.1 | 2026.7.16 |
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
| Webhook 双通道 | ❌ 仅 WebSocket | ✅ WS + webhook | ❌ |
| 测试套件 | ✅ **vitest 基座（15 文件 / 128 用例）** | ✅ 99 文件 / 1202 用例 | ❌ 无 |
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
| Webhook 双通道 | 本插件暂未实现（同字节），仅 WebSocket；官方支持 WS + webhook。 |
| PIN 消息 | 本插件已支持；字节 7.16 无。 |
| 测试规模 | 本插件为最小基座（128 用例），远小于官方（1202），但覆盖核心安全与路由路径。 |
| 工具展示开关 | `toolUseDisplay.enabled:false` 可关，默认开。 |

---

## 更新日志

<details open>
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

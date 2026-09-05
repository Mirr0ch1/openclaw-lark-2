# openclaw-lark-2

**OpenClaw 2.0（2026.8.1+）专属飞书 / Lark 渠道插件** · An OpenClaw 2.0 (2026.8.1+) Feishu / Lark channel plugin — an independent fork of `@larksuite/openclaw-lark`.

> **背景 / Background**
>
> OpenClaw 2.0（2026.8.1）重构了插件 SDK：移除了裸 `openclaw/plugin-sdk` 导出、重命名了多个子路径、session 存储从 JSON 迁移到 SQLite。官方 `@larksuite/openclaw-lark` 未跟进，导致在 2.0 下无法加载、卡片 footer 指标消失。本插件针对 2.0 SDK 全面适配，开箱即用。
>
> OpenClaw 2.0 (2026.8.1) reworked the plugin SDK: removed the bare `openclaw/plugin-sdk` export, renamed several subpaths, and migrated session storage from JSON to SQLite. The official `@larksuite/openclaw-lark` did not follow up, so it fails to load on 2.0 and loses card footer metrics. This plugin is fully adapted to the 2.0 SDK — plug and play.

---

## 特性 / Features

- **OpenClaw 2.0 原生适配**：SDK 导入路径 / 类型 / 运行时 API 全部对齐 2026.8.1 / Native 2.0 adaptation: SDK import paths, types, and runtime APIs aligned with 2026.8.1
- **飞书 / Lark 全量能力**：IM 消息（含 CardKit 流式卡片）、文档（doc/wiki/drive）、多维表格（bitable）、日历、任务、电子表格等 / Full Feishu/Lark capabilities: IM messages (incl. CardKit streaming cards), docs (doc/wiki/drive), bitable, calendar, tasks, sheets, and more
- **内置 `ask_user` 工具按钮渲染**：通用 `ask_user` 问题渲染为带选项按钮的交互卡片，点击即解析；支持"其他答案"输入框表单；群聊中所有成员均可交互 / Built-in `ask_user` button rendering: generic `ask_user` questions become interactive cards with option buttons; supports an "Other answer" input form; every group member can interact
- **工具调用动态展示**：流式卡片内实时展示 agent 正在调用的工具步骤，默认开启（`channels.feishu.toolUseDisplay.enabled: false` 可关） / Live tool-activity display inside streaming cards, on by default (disable via `channels.feishu.toolUseDisplay.enabled: false`)
- **群聊流式卡片**：`channels.feishu.replyMode.group: "streaming"` 让群聊与私聊一样使用流式卡片 / Group streaming cards: `channels.feishu.replyMode.group: "streaming"` gives groups the same streaming-card experience as DMs
- **多图合并为一条富文本 post**：模型一次发送 ≥2 张图片时默认合并为**一条** post 消息（飞书无相册 API，每张图一个段落）；`channels.feishu.multiImageMode: "sequential"` 可改回逐张发送。任一张上传失败自动回退逐张，不丢图 / Multi-image merged post: when the model emits ≥2 images at once they merge into a **single** rich-text post by default (Feishu has no album API; one `img` paragraph per image). Set `channels.feishu.multiImageMode: "sequential"` for legacy per-image sends. Any upload failure falls back to per-image sends — nothing is lost.
- **完整 footer 指标**：状态 · 耗时 · model · **provider** · tokens · cache · context（7 项，provider 为本分支新增）/ Full footer metrics: status · elapsed · model · **provider** · tokens · cache · context (7 items; `provider` is new in this fork)
- **SSRF 防护**：所有出站 HTTP 请求统一走 SDK `fetchWithSsrFGuard`——DNS pinning 防 rebinding、IPv4+IPv6 私有/保留地址阻断、重定向逐跳校验、hostname 白名单 / SSRF protection: all outbound HTTP goes through the SDK `fetchWithSsrFGuard` — DNS pinning (anti-rebinding), IPv4+IPv6 private/reserved-address blocking, per-hop redirect validation, hostname allowlist
- **PIN 消息操作**：内置 message 工具新增 `pin` / `unpin` / `list-pins` / PIN message actions: `pin` / `unpin` / `list-pins` on the built-in message tool
- **测试基座**：vitest 最小测试套件（`npm test`） / Test base: a minimal vitest suite (`npm test`)
- **多账号**：一个 openclaw 实例同时接入多个飞书应用 / Multi-account: run multiple Feishu apps on a single OpenClaw instance

---

## 版本记录 / Changelog

| 版本 / Version | 日期 / Date | 说明 / Notes |
|---|---|---|
| **2026.9.6** | 2026-09-06 | 修复 OpenClaw 2.0 多账号下入站消息全部静默丢弃（`PreparedModelCatalogConfigReplacedError`）：核心调度改用未被篡改的全局 config + `usePublishedModelRuntime`（PR #1，by leothebravest）；补齐 comment / reaction / VC 邀请三条链路的 config 透传，并阻断 `config.current()` 返回空对象导致的 `cfg: {}` 派发；新增 6 条派发配置单测（11 文件 103 用例） / Fix inbound messages being silently dropped on OpenClaw 2.0 multi-account setups (`PreparedModelCatalogConfigReplacedError`): core dispatch now uses the untampered global config plus `usePublishedModelRuntime` (PR #1, by leothebravest); plumbed the config through the comment / reaction / VC-invited paths and blocked `cfg: {}` dispatch when `config.current()` returns an empty object; added 6 dispatch-config tests (11 files / 103 tests) |
| **2026.9.4** | 2026-09-03 | 多图合并为一条富文本 post：`channels.feishu.multiImageMode`（默认 `post`，`sequential` 回退逐张；任一上传失败自动回退）(10 文件 97 用例) / Merged multi-image post: `channels.feishu.multiImageMode` (default `post`; `sequential` restores per-image sends; auto-fallback on any upload failure) (10 files / 97 tests) |
| **2026.9.3** | 2026-09-02 | SSRF 防护全量落地、PIN 消息操作、vitest 测试基座（9 文件 78 用例）+ 全量安全测试通过 / Full SSRF protection, PIN message actions, vitest test base (9 files / 78 tests) + complete security testing passed |
| **2026.9.2** | 2026-09-01 | 修复 ask_user "其他答案"提交；移除 feishu_ask_user_question；群聊流式卡片；工具 dry-run 脚本 / Fix ask_user "Other" submit; remove feishu_ask_user_question; group streaming cards; tool dry-run script |
| **2026.9.1** | 2026-09-01 | OpenClaw 2.0 兼容修复、内置 ask_user 按钮渲染、工具动态展示、ClawHub 发布 / OpenClaw 2.0 compat fixes, built-in ask_user buttons, tool-activity display, ClawHub release |
| **2026.8.1** | 2026-08-31 | 初始 2.0 适配分支 / Initial 2.0 adaptation branch |

---

## 三方详细对比 / Three-Way Comparison

本插件在设计上**取两家之长**：以字节 `@larksuite/openclaw-lark` 的完整工具面为基础，吸收官方 `@openclaw/feishu` 的 OpenClaw 2.0 原生架构与安全工程，再补齐两家的短板（ask_user 按钮、PIN、SSRF 全量防护、测试基座）。

This plugin takes the best of both worlds: the complete tool surface of ByteDance's `@larksuite/openclaw-lark`, the OpenClaw 2.0-native architecture and security engineering of the official `@openclaw/feishu`, plus features neither has (ask_user buttons, PIN, full SSRF coverage, a test base).

| 维度 / Dimension | **openclaw-lark-2 (ours)** | **@openclaw/feishu (official 2.0)** | **@larksuite/openclaw-lark 7.16 (ByteDance)** |
|---|---|---|---|
| 版本 / Version | **2026.9.6** | 2026.8.1 | 2026.7.16 |
| OpenClaw 兼容 / Compat | **>=2026.8.1（2.0 原生）** | >=2026.8.1 (native 2.0) | >=2026.5.4（1.x，2.0 下无法加载 / cannot load on 2.0） |
| Plugin API | 2.0 SDK（`runtime.config.current()`） | 2.0 SDK（`createChatChannelPlugin`） | 1.x API（`loadConfig`，已废弃 / deprecated） |
| 契约工具数 / Contract tools | **38** | 14 | 39 |
| calendar / task / sheets | ✅ | ❌ | ✅ |
| im 消息收发 / 搜索工具 / IM send-read-search tools | ✅ 6 | ❌（走 channel action） | ✅ 6 |
| 入站消息转换器 / Inbound converters | **22 种** | 部分 / partial | 22 种 |
| 流式回复 / Streaming (CardKit) | ✅ 群聊 + 私聊 | ✅ | ✅ 须开 `streaming:true` |
| 多图合并 post / Multi-image post | ✅ **默认一条 post**（`multiImageMode` 可回退） | ❌ 仅逐张 / per-image only | ❌ 仅逐张 / per-image only |
| 群聊流式卡片 / Group streaming | ✅ `replyMode.group:"streaming"` | ✅ | ❌ 群聊默认 static |
| 工具动态展示 / Tool activity | ✅ **默认开启 / on by default** | ⚠️ 仅 verbose/preview | ⚠️ 依赖 verbose（默认 off） |
| 内置 `ask_user` 按钮 | ✅ **按钮卡片 + "其他答案" + 群聊全员可交互** | ❌ 仅文本回退 / text fallback only | ❌ 用自家 feishu_ask_user_question |
| PIN 消息操作 / PIN actions | ✅ `pin`/`unpin`/`list-pins` | ✅ | ❌ |
| SSRF 防护 / SSRF protection | ✅ **全量出站 / all outbound**（DNS pinning + 私网阻断 + 重定向校验 + hostname 白名单） | ✅ 仅 CardKit/注册请求 | ⚠️ 手写 IPv4-only 检查 |
| 输入中指示 / Typing indicator | ✅ reaction 式 | ✅ reaction 式 | ✅ reaction 式 |
| reactions / 文档评论 / doc comments | ✅ | ✅ | ✅ |
| OAuth device-flow | ✅ | ❌（仅 app 注册向导） | ✅ |
| Webhook 双通道 / Dual-channel webhook | ❌ 仅 WebSocket | ✅ WS + webhook | ❌ |
| 测试套件 / Test suite | ✅ **vitest 基座（9 文件 / 78 用例）** | ✅ 99 文件 / 1202 用例 | ❌ 无 |
| 安全审计 / Security audit | ✅ plugin-inspector 报告 | ✅ security-audit + SSRF | ⚠️ 无 |

### 取长补短的思路 / Design Rationale

1. **工具面 = 字节 7.16 全家桶**：38 个工具覆盖 im / doc / wiki / drive / bitable / calendar / task / sheets / search / oauth，官方 2.0 只有 14 个（无 calendar/task/sheets/im 消息工具）。唯一移除的是字节自研 `feishu_ask_user_question`（已被内置 `ask_user` 按钮渲染取代）。
   **Tool surface = ByteDance 7.16 full set**: 38 tools covering im/doc/wiki/drive/bitable/calendar/task/sheets/search/oauth; the official 2.0 has only 14 (no calendar/task/sheets/im-message tools). The only removal is ByteDance's custom `feishu_ask_user_question`, superseded by built-in `ask_user` button rendering.
2. **架构 = 官方 2.0 原生适配**：完整使用 OpenClaw 2.0 SDK；字节 7.16 因用 `loadConfig` 在 2.0 下直接无法加载。
   **Architecture = official 2.0-native**: full OpenClaw 2.0 SDK usage; ByteDance 7.16 cannot load on 2.0 because it uses `loadConfig`.
3. **交互增强（两家都没有的）**：内置 `ask_user` 按钮卡片（官方只做文本回退，字节用另一套非阻塞表单）；工具动态展示默认开启（两家都要手动开 verbose）；PIN 消息操作（字节没有）。
   **Interaction upgrades (neither has)**: built-in `ask_user` button cards; tool-activity display on by default; PIN message actions.
4. **安全补强（取官方）**：把官方 2.0 的 `fetchWithSsrFGuard` 应用到**全部**出站请求，官方只用于 CardKit 与 app 注册，字节只有手写 IPv4 检查。
   **Security hardening (from official)**: `fetchWithSsrFGuard` applied to **all** outbound requests; the official applies it only to CardKit/app registration, ByteDance has a hand-written IPv4-only check.
5. **工程化补强（取官方）**：建立 vitest 测试基座（官方 1202 用例的质量目标，字节零测试），并保留 plugin-inspector 安全报告。
   **Engineering (from official)**: a vitest test base (targeting the official's 1202-test quality bar; ByteDance has zero tests), plus the plugin-inspector security report.

### 已知差异 / Known Differences (honest)

| 项 / Item | 说明 / Note |
|---|---|
| Webhook 双通道 / Dual-channel webhook | 本插件暂未实现（同字节），仅 WebSocket；官方支持 WS + webhook / Not yet implemented (like ByteDance), WebSocket only; official supports WS + webhook |
| PIN 消息 / PIN actions | 本插件已支持；字节 7.16 无 / Supported here; missing in ByteDance 7.16 |
| 测试规模 / Test scale | 本插件为最小基座（78 用例），远小于官方（1202），但覆盖核心安全与路由路径 / Minimal base (78 tests), far smaller than official (1202), but covers core security & routing paths |
| 工具展示开关 / Tool-display toggle | 本插件 `toolUseDisplay.enabled:false` 可关，默认开 / Toggle via `toolUseDisplay.enabled:false`, on by default |

---

## 安装 / Installation

### 通过 ClawHub / via ClawHub

```bash
openclaw plugin install @mirr0ch1/openclaw-lark-2
```

### 通过 tarball（本机开发）/ via tarball (local dev)

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.9.6.tgz
```

---

## 配置 / Configuration

插件注册 `feishu` 渠道，与官方版共用 `channels.feishu` 配置结构 / The plugin registers the `feishu` channel and shares the `channels.feishu` config shape with the official plugin:

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",
      // 多账号示例 / multi-account example
      accounts: {
        plaud: { appId: "cli_yyy", appSecret: "yyy", dmPolicy: "pairing" },
      },
      // footer 七项全开（provider 为新增项）/ all 7 footer metrics on (provider is new)
      footer: {
        status: true,
        elapsed: true,
        model: true,
        provider: true,
        tokens: true,
        cache: true,
        context: true,
      },
      // 多图合并：post（默认，一次发多条图为一条）/ sequential（逐张发送）
      // multi-image: "post" (default, merge ≥2 images into one rich-text post)
      //              | "sequential" (legacy per-image sends)
      multiImageMode: "post",
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> 提示：飞书应用需在开放平台开通 `cardkit:card:write` 权限，流式卡片才能生效。
> Tip: the Feishu app needs the `cardkit:card:write` scope enabled in the Open Platform for streaming cards to work.

---

## 开发 / Development

```bash
npm install            # 安装依赖（含 vitest）/ install deps (incl. vitest)
npm test               # 运行 vitest 测试套件 / run the vitest test suite
npm run test:watch     # 测试监听模式 / watch mode
```

插件为 CommonJS 源码（`src/` + `index.js` 入口），无需构建步骤，改动后同步到 OpenClaw 扩展目录并重启网关即可生效。

The plugin is CommonJS source (`src/` + `index.js` entry) with no build step — sync to the OpenClaw extensions directory and restart the gateway to apply changes.

---

## 致谢 / 许可 — Credits / License

基于 [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark)（MIT）二次开发。保留 MIT 许可。

Forked from [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) (MIT). MIT licensed.

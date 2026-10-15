<div align="center">

# openclaw-lark-2

**An OpenClaw 2.0-native Feishu / Lark channel plugin**

An independent fork of `@larksuite/openclaw-lark`, fully adapted to the OpenClaw 2.0 SDK.

[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.8.1-3b82f6?style=flat-square)](#installation)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-448%20passing-22c55e?style=flat-square)](#development)
[![ClawHub](https://img.shields.io/badge/ClawHub-%40mirr0ch1%2Fopenclaw--lark--2-8b5cf6?style=flat-square)](https://clawhub.ai)

**English** · [中文](./README.md)

</div>

---

## Table of Contents

- [Why this fork](#why-this-fork)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Three-Way Comparison](#three-way-comparison)
- [Changelog](#changelog)
- [Development](#development)
- [Credits & License](#credits--license)

---

## Why this fork

OpenClaw 2.0 (2026.8.1) reworked the plugin SDK:

- the bare `openclaw/plugin-sdk` export was removed and several subpaths renamed;
- session storage moved from JSON to SQLite;
- channel capabilities (e.g. durable-final delivery `durableFinal`) became explicit contracts.

`@larksuite/openclaw-lark` did not follow up, so it **fails to load** on 2.0 and loses card footer metrics. This fork is fully adapted to the 2.0 SDK — plug and play.

---

## Features

### Architecture & Compatibility

- **Native OpenClaw 2.0 adaptation**: SDK import paths, types, and runtime APIs aligned with 2026.8.1.
- **Multi-account**: run multiple Feishu apps on a single OpenClaw instance.

### Messaging & Interaction

- **Streaming cards (CardKit)**: the same experience in groups and DMs via `channels.feishu.replyMode.group: "streaming"`.
- **Live tool-activity display**: shows the tools the agent is calling in real time, on by default.
- **Built-in `ask_user` button cards**: questions render as interactive cards with option buttons plus an “Other answer” input form; every group member can interact.
- **Multi-image merged post**: ≥2 images emitted at once merge into a **single** rich-text post by default (Feishu has no album API; one image per paragraph); `multiImageMode: "sequential"` restores per-image sends, with auto-fallback on any upload failure — nothing is lost.
- **Full 7-item footer metrics**: status · elapsed · model · **provider** · tokens · cache · context (`provider` is new in this fork).
- **PIN message actions**: `pin` / `unpin` / `list-pins` on the built-in message tool.

### Transport & Reliability

- **Dual-channel webhook**: `connectionMode: "webhook"` uses Feishu callbacks (signature check `sha256(timestamp+nonce+encryptKey+body)`, timestamp-skew bound, `url_verification` challenge, pre-auth guards for body size / timeout / concurrency). WebSocket remains the default.
- **Optional durable inbound queue**: `durableIngress: true` admits `im.message.receive_v1` / doc-comment events into the host's persistent queue with per-conversation lane ordering and retryable/permanent error classification. Off by default — behavior is byte-for-byte unchanged.
- **Send rate-limit retry**: unifies HTTP 429 and business codes `230020` / `11232` (including “HTTP 200 but the body carries a rate-limit code”) across every IM send path.
- **Per-conversation queue task timeout**: each dispatch is capped at 5 minutes by default; a timed-out task keeps running but stops blocking later messages in the same conversation (upstream #70133).
- **Retry-stable dedupe**: text/post messages dedupe on `sender + chat + create_time + content hash`, so a redelivery with a fresh `message_id` is still caught (upstream #46778).
- **Envelope-aware pagination**: over-30KB rich posts are split by **serialized byte size**, not character count (15000 CJK chars ≈ 45KB).

### Security & Engineering

- **Read policy (matching official read-policy)**: tool reads are policy-gated — **the current conversation is always readable**; cross-group reads follow `groupPolicy` (`disabled` denies even the current group); **cross-DM reads require `allowFrom` to contain `*`**. Applies to `feishu_chat.get` and `feishu_chat_members` (a DM returns only the current sender).
- **Full SSRF coverage**: all outbound HTTP goes through the SDK `fetchWithSsrFGuard` — DNS pinning (anti-rebinding), IPv4+IPv6 private/reserved-address blocking, per-hop redirect validation, hostname allowlist.
- **Tool-result fencing**: model-visible tool output is wrapped in an `EXTERNAL_UNTRUSTED_CONTENT` marker to resist prompt injection from documents/messages; failures also carry `http_status` / `feishu_code` / `feishu_msg` / `feishu_log_id`.
- **Native-card sanitization**: model-authored cards get an element allowlist, http(s)-only button URLs, a callback-value gate, and text escaping before send.
- **Fail-safe diagnostic hooks**: `before_tool_call` / `after_tool_call` are **fail-closed** in OpenClaw — one thrown exception blocks the **entire** tool call (regardless of tool). Both hooks here run fully guarded (`try/catch` + defensive field reads), so they log only and **never block** the tool pipeline.
- **Test base**: a vitest suite (`npm test`) covering core security and routing paths.
- **Plugin Inspector report**: `clawhub package validate` with 0 warnings.

### Multi-account & Tools

- **Per-call account targeting**: every tool accepts an optional `accountId`; an explicit account that is unconfigured or disabled **fails loudly** instead of silently falling back to the first account.
- **Config signals**: the manifest declares `toolMetadata.configSignals`, so the host hides tools when `appId`/`appSecret` is missing.

### Built-in Skills

The plugin ships a set of Feishu skills, all routed through **`lark-cli`** as the single operation entry point (ByteDance replaced the plugin's built-in `feishu_*` tools with `lark-cli`):

- `feishu-doc` / `feishu-bitable` / `feishu-calendar` / `feishu-im-read` / `feishu-task` — point to the matching `lark-cli <domain>` and the official `lark-*` skills; they check lark-cli availability first and, when missing, tell the user to install `@larksuite/cli` instead of falling back to the disabled built-in tools.
- `feishu-channel-rules` — Lark card Markdown syntax reference; common formatting rules are **injected every turn** by the plugin, so it need not be always-on.
- `feishu-troubleshoot` — plugin / channel self-troubleshooting (card-callback permission FAQ, `/feishu doctor`).

---

## Installation

### via ClawHub

```bash
openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2
```

### via tarball (local dev)

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.10.9.tgz
```

---

## Configuration

The plugin registers the `feishu` channel and shares the `channels.feishu` config shape with the official plugin.

```json5
{
  channels: {
    feishu: {
      enabled: true,
      appId: "cli_xxx",
      appSecret: "xxx",

      // multi-account example
      accounts: {
        plaud: { appId: "cli_yyy", appSecret: "yyy", dmPolicy: "pairing" },
      },

      // all 7 footer metrics on (provider is new)
      footer: {
        status: true,
        elapsed: true,
        model: true,
        provider: true,
        tokens: true,
        cache: true,
        context: true,
      },

      // multi-image: "post" (default, merge ≥2 images) | "sequential" (per-image)
      multiImageMode: "post",

      // streaming cards in groups and DMs
      replyMode: { group: "streaming" },

      // transport: "websocket" (default) | "webhook" (Feishu callbacks)
      connectionMode: "websocket",

      // optional: admit inbound events into the host's durable queue (default false)
      // durableIngress: true,

      // optional: routing preference when no explicit accountId is given
      // (never re-activates a disabled account)
      // defaultAccount: "plaud",
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> **Scope tip**: the Feishu app needs the `cardkit:card:write` scope enabled in the Open Platform for streaming cards to work.
>
> **Read policy**: `feishu_chat.get` / `feishu_chat_members` are policy-gated. Reading a **non-current** DM requires that account's `allowFrom` to contain `"*"` (note this also widens DM **ingress** admission); cross-group reads follow `groupPolicy`, and `groupPolicy: "disabled"` denies even the current group. Message-history tools (`feishu_im_user_get_messages`, …) are unaffected.

---

## Three-Way Comparison

This plugin takes the best of both worlds: the complete tool surface of ByteDance's `@larksuite/openclaw-lark`, the OpenClaw 2.0-native architecture and security engineering of the official `@openclaw/feishu`, plus features neither has.

| Dimension | **openclaw-lark-2 (ours)** | **@openclaw/feishu (official 2.0)** | **@larksuite/openclaw-lark 7.16 (ByteDance)** |
|---|:---:|:---:|:---:|
| Version | **2026.10.9** | 2026.8.1 | 2026.7.16 |
| OpenClaw compat | **≥2026.8.1 (native 2.0)** | ≥2026.8.1 (native 2.0) | ≥2026.5.4 (1.x, cannot load on 2.0) |
| Plugin API | 2.0 SDK (`runtime.config.current()`) | 2.0 SDK (`createChatChannelPlugin`) | 1.x API (`loadConfig`, deprecated) |
| Contract tools | **38** | 14 | 39 |
| calendar / task / sheets | ✅ | ❌ | ✅ |
| im send / read / search tools | ✅ 6 | ❌ (via channel action) | ✅ 6 |
| Inbound converters | **22 kinds** | partial | 22 kinds |
| Streaming reply (CardKit) | ✅ groups + DMs | ✅ | ✅ (needs `streaming:true`) |
| Multi-image post | ✅ **single post by default** | ❌ per-image only | ❌ per-image only |
| Group streaming cards | ✅ `replyMode.group:"streaming"` | ✅ | ❌ group defaults to static |
| Tool-activity display | ✅ **on by default** | ⚠️ verbose/preview only | ⚠️ verbose-dependent (off by default) |
| Built-in `ask_user` buttons | ✅ **button cards + “Other answer” + all group members can interact** | ❌ text fallback only | ❌ uses its own `feishu_ask_user_question` |
| PIN actions | ✅ `pin`/`unpin`/`list-pins` | ✅ | ❌ |
| SSRF protection | ✅ **all outbound** (DNS pinning + private-address blocking + redirect validation + hostname allowlist) | ✅ CardKit / registration only | ⚠️ hand-written IPv4-only check |
| Typing indicator | ✅ reaction-based | ✅ reaction-based | ✅ reaction-based |
| reactions / doc comments | ✅ | ✅ | ✅ |
| OAuth device-flow | ✅ | ❌ (app-registration wizard only) | ✅ |
| Dual-channel webhook | ✅ **WS + webhook (webhook optional)** | ✅ WS + webhook | ❌ |
| Durable inbound queue | ✅ **optional (`durableIngress`)** | ✅ on by default | ❌ |
| Read policy | ✅ matches official | ✅ | ❌ |
| Per-call account targeting | ✅ `accountId` on every tool | ✅ | ❌ |
| Test suite | ✅ **vitest base (59 files / 448 tests)** | ✅ 99 files / 1202 tests | ❌ none |
| Security audit | ✅ plugin-inspector report | ✅ security-audit + SSRF | ⚠️ none |

### Design Rationale

1. **Tool surface = ByteDance 7.16 full set**: 38 tools covering im / doc / wiki / drive / bitable / calendar / task / sheets / search / oauth; the official 2.0 has only 14. The only removal is ByteDance's custom `feishu_ask_user_question`, superseded by built-in `ask_user` button rendering.
2. **Architecture = official 2.0-native**: full OpenClaw 2.0 SDK usage; ByteDance 7.16 cannot load on 2.0 because it uses `loadConfig`.
3. **Interaction upgrades (neither has)**: built-in `ask_user` button cards; tool-activity display on by default; PIN message actions.
4. **Security hardening (from official)**: `fetchWithSsrFGuard` applied to **all** outbound requests; the official applies it only to CardKit / app registration, ByteDance has a hand-written IPv4-only check.
5. **Engineering (from official)**: a vitest test base plus the plugin-inspector security report.

### Known Differences

| Item | Note |
|---|---|
| Webhook transport | Supported and **optional** (`connectionMode: "webhook"`); WebSocket stays the default. |
| Durable inbound queue | Supported but **off by default** (`durableIngress: true` to enable); the official enables it by default. When enabled, behavior matches the original direct WS dispatch, plus per-conversation ordering and restart survival. |
| Read policy | Semantics match the official; because our tools get no host context, the read context is reconstructed from the **current message ticket** — so with no message context (cron/heartbeat) cross-DM reads are denied by policy. |
| PIN actions | Supported here; missing in ByteDance 7.16. |
| Test scale | Minimal base (59 files / 448 tests), far smaller than the official (1202), but covers core security & routing paths. |
| Tool-display toggle | Toggle via `toolUseDisplay.enabled:false`; on by default. |

---

## Changelog

<details open>
<summary><b>2026.10.9</b> · 2026-10-15 · Dead-code cleanup</summary>

Removed 15 exports with zero references in `src/`, `tests/`, or `index.js` (-151 lines): the card-trace `hasToolUseTraceRun` / `_resetForTesting`, `read-policy`'s `canEnumerateAllFeishuGroups`, `shutdown-hooks`' `_resetShutdownHooks`, `tool-scopes`' `REQUIRED_SCOPE_DESCRIPTIONS`, `bot-loop-guard`'s `resetAllBotLoops` / `botLoopStateSize`, `sentinel-store`'s `clearSentinelStore` (and the cascaded `clearAllSentinelStores`), `time-utils`' `secondsStringToDateTime` / `dateTimeToMillis` (and the cascaded `secondsToDateTime`), plus the **intentionally-disabled multi-account-isolation** helpers `generateIsolationFixCommands` / `generateSharedAgentCommands` (and the cascaded `getDmScopeFixCommand`) — the wired no-op stubs `collectIsolationWarnings` / `emitSecurityWarnings` are kept.

`CARD_PHASES` is kept: it is not dead — the exported `CardPhase` type derives from it via `typeof CARD_PHASES`. The matching `.d.ts` declarations were removed too.

**Tests**: **59 files / 450 tests**.

</details>

<details>
<summary><b>2026.10.8</b> · 2026-10-15 · Robustness hardening (parity pass vs. official) + inbound debounce merge</summary>

A systematic robustness pass over the plugin's own code (batches A / B / C plus follow-up fixes), benchmarked against the official `@openclaw/feishu`, plus the inbound debounce merge.

**Reliability fixes (batch A / S1)**

- **Webhook crash**: fixed a `ReferenceError` on the webhook path.
- **Outbound code assertion**: no longer misclassifies outbound error codes.
- **Streaming config**: `streaming` schema and runtime aligned.
- **Accounts / targets**: parsing fixes (incl. `lark:` / `group:` / `channel:` / `dm:` prefixes and tag awareness).
- **Pending-history key**: the group pending-history key is aligned to the official `groupHistoryKey` (no `:thread:` suffix) — fixes the read/write bucket mismatch for `root_id`-inferred threads under `threadSession`, which silently dropped context.

**Reliability fixes (batch B)**

- **Reaction access gate**: reaction events now pass the access gate before dispatch (security).
- **Withdrawn-reply fallback**: a withdrawn reply target falls back to a new message (official `sendReplyOrFallbackDirect`).
- **groupSessionScope inbound**: `group` / `group_sender` / `group_topic` / `group_topic_sender` scopes now take effect inbound.
- **Interactive dedupe key**: card interactions dedupe by `event_id` / `token` (retry-stable).
- **Abort fast-path key**: the abort fast-path queue key matches the dispatch key.

**Reliability fixes (batch C)**

- **`onDeliveryResult` forwarding**: the outbound adapter reports every physical send back to core (partial-delivery / subagent completion tracking); a callback failure is logged only and never affects an already-delivered send.
- **Persistent dedupe**: inbound dedupe now uses the host `openclaw/plugin-sdk/persistent-dedupe` (SQLite) with **claim / commit / release** semantics — no more reprocessing across restarts, and the commit happens *after* the message is enqueued/adopted so a crash cannot permanently swallow a redelivery. TTL aligned to the official 24 h.
- **Bounded mention registry**: the name→openId registry is capped on both dimensions (500 names/chat, 500 chats, LRU refresh) — no longer unbounded.
- **Outbound media cap + failure propagation**: outbound media is capped at `min(mediaMaxMb, 30MB)` (remote bodies are stream-read with a hard abort, bounding memory); `mediaMaxMb` must be positive; the direct `send` action now surfaces an attachment upload failure (#112244) while the channel-level reply keeps its text-link fallback.

**Inbound debounce merge (P3-A6, opt-in)**

- Core config `messages.inbound.debounceMs` (default 0 = off). When enabled, consecutive **text** messages from one `(account / chat / thread / sender)` within a quiet window are merged into one and trigger a single agent turn (control commands are excluded), reducing reply spam and giving the model fuller context.
- Integrates with `durableIngress`: the durable row's lifecycle is handed to the handler keyed by `event_id`, so the row is not tombstoned until the flush completes — **a crash inside the debounce window does not lose messages** (official `buildFeishuFlushIngressLifecycle`).

**Final review (parity pass vs. official main `c36af74`)**

- **`replyInThread` config type**: the schema and runtime disagreed (schema `boolean` vs runtime comparing the official string enum `"enabled"`), so a boolean `true` was a silent no-op and the official `"enabled"` failed validation. Both forms are now accepted and normalised.
- **Allowlist prefixes**: `feishu:` / `lark:` / `user:` / `open_id:` entries were silently rejected; now normalised like the official.
- **`@all` detection**: widened to the official `@all` / `@_all` keys plus `id.* === "all"` (previously only `@_all`).
- **Reaction / doc-comment dispatch**: `botOpenId` is now threaded through (the group system prompt / identity fields / bot-peer mention resolution were empty).
- **Media fallback link**: the upload-failure fallback now SSRF-validates the URL (only a public http(s) reference is echoed, otherwise a generic failure notice) — official `resolvePublicFeishuMediaReference`.
- **Dead code removed**: the never-wired onboarding adapter (3 modules) targeting the removed `OnboardingAdapter` host contract, and the unused `agent-config` module.

**Tests**: 30 files / 226 tests → **59 files / 448 tests**.

</details>

<details>
<summary><b>2026.10.6</b> · 2026-10-14 · Diagnostic hooks hardened: never fail-close the tool pipeline</summary>

`before_tool_call` is **fail-closed** in OpenClaw: if a plugin hook throws, the **entire tool call** is blocked — and it does **not** discriminate by tool. These two hooks only do call tracing and logging, so they must not have that power.

**Fixes**

- Both diagnostic hooks (`before_tool_call` / `after_tool_call`) now wrap their **whole body in `try/catch`**: any error degrades to a single `log.warn` and the call proceeds — tools are **never blocked**.
- Hook-event fields are read defensively (`event?.toolName ?? ''`, `ctx?.sessionKey`), immune to host contract changes.

**Troubleshooting**

> If, after a plugin hot-update (`plugins install` / `plugins reload`), **all** cron / headless tool calls are blocked and the log shows
> `before_tool_call hook failed: … PluginInstanceUnavailableError: Plugin openclaw-lark-2 was reloaded or disabled; use its current tools.`
> — the host retained a **hook from the previous plugin generation** after a **drain timeout**. It is unrelated to this plugin's code.
> Run `openclaw plugins reload openclaw-lark-2` to clear it (restart the gateway if that fails); interactive sessions are usually unaffected.

**Tests**: 30 files / 226 tests.

</details>

<details>
<summary><b>2026.10.5</b> · 2026-10-14 · Align with official <code>@openclaw/feishu</code>: reliability primitives · read policy · multi-account routing</summary>

Ported the official plugin's (openclaw `main` `2f620b9`, 2026-10-12) more mature engineering primitives, plus multi-account targeting and read policy. **Most additions are optional or behavior-neutral**; the read policy is the only intentional tightening.

**Reliability**

- **Tool-result fencing + structured errors**: model-visible output is wrapped in `EXTERNAL_UNTRUSTED_CONTENT`; failures carry `http_status`/`feishu_code`/`feishu_msg`/`feishu_log_id`.
- **Unified send rate-limit retry**: 429 and `230020`/`11232` (including “200 but the body is a rate-limit code”) across all IM send paths.
- **Per-conversation queue timeout**: each dispatch capped at 5 minutes; a timeout no longer blocks later messages in the same conversation (#70133).
- **Retry-stable dedupe**: text/post dedupe on `sender+chat+create_time+content hash` (#46778).
- **Native-card sanitization**: element allowlist + http(s)-only button URLs + callback-value gate + text escaping (model-authored cards only).
- **Probe error cache (1 min) + directory pagination guards**; **rich posts split by 30KB serialized bytes**.

**Transport & delivery**

- **Webhook transport** (`connectionMode: "webhook"`, optional): signature check + skew bound + challenge + body/concurrency pre-auth guards.
- **Durable inbound queue** (`durableIngress: true`, off by default): host queue + per-conversation lane ordering + retryable/permanent classification.
- **Send authority**: a retired/aborted turn throws `PlatformMessageNotDispatchedError` (`retryable:false`) before sending, so stale messages are never dispatched.

**Multi-account & read policy**

- **Per-call account targeting**: every tool accepts an optional `accountId`; unknown/unconfigured/disabled accounts fail loudly instead of silently falling back to the first account.
- **Read policy** (matching official): `feishu_chat.get` / `feishu_chat_members` are gated — the current conversation is readable; cross-group reads follow `groupPolicy`; **cross-DM reads require `allowFrom` to contain `*`**.
- **Config signals**: manifest `toolMetadata.configSignals` hides tools when credentials are absent.

**Other**

- **Doc-comment typing reaction**: comment events have no IM message to attach a typing indicator to, so a `Typing` reaction is added to the comment reply and removed when the turn ends (disable with `typingIndicator: false`).
- **`openclaw doctor --fix` config repair**: a root `doctor-contract-api` artifact normalises `channels.feishu[.accounts.<id>].webhookPath` (named accounts get an account-scoped path so they cannot collide with the default account's route).

**Fixes**: `config-schema` gained `durableIngress` / `defaultAccount` / `typingIndicator`; removed a duplicated `multiImageMode` in the `accounts` shape of `config-schema.d.ts`; `.d.ts` kept in sync with runtime.

**Tests**: 15 files / 128 tests → **30 files / 226 tests**; `clawhub package validate` passes.

</details>

<details>
<summary><b>2026.10.3</b> · 2026-10-03 · Skills rewritten as lark-cli thin pointers + always-on channel formatting</summary>

All built-in skills are reworked around **`lark-cli`** as the single operation entry point: `feishu-create-doc` / `feishu-fetch-doc` / `feishu-update-doc` are merged into `feishu-doc` (the `feishu_mcp_*` tool names they referenced were long dead); `feishu-bitable` / `feishu-calendar` / `feishu-im-read` / `feishu-task` now point to the matching `lark-cli <domain>` and official `lark-*` skills, keeping only channel-specific notes. Added a "lark-cli missing" fallback that tells the user to install `@larksuite/cli` instead of falling back to the disabled tools. Fixed the dead `alwaysActive` flag in `feishu-channel-rules` — Lark card formatting rules are now injected every turn via `agentPrompt.inboundFormattingHints`; corrected the outdated notes on automatic heading downgrade and image URL→key resolution. Skill size: 4803 → 538 lines. (15 files / 128 tests)

</details>

<details>
<summary><b>2026.10.2</b> · 2026-10-03 · Docs: split README into Chinese (default) and English</summary>

Split the README into two files: `README.md` (Chinese, default) and `README.en.md` (English); fixed the ClawHub install command to `openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2`. No code changes.

</details>

<details>
<summary><b>2026.9.20</b> · 2026-10-03 · Fix default-account group commands treated as unauthorized</summary>

`getLarkAccount` skipped the `accounts.default` override entirely when `accountId === 'default'`, dropping `allowFrom / groupAllowFrom / dmPolicy / groupPolicy` declared there (core's `resolveFallbackAccountConfig` reads these; the plugin did not → the two disagreed). DMs were masked by the pairing allow-from store, but groups neither read the store nor kept `groupAllowFrom`, so the plugin computed `CommandAuthorized=false` and core silently refused owner-level commands like `/new` and `/reset` (`Ignoring /new from unauthorized sender`) — no reset, no visible reply, only the generic fallback. Default-account overrides are now merged like any other account. Added 6 account regression tests (14 files / 126 tests).

</details>

<details>
<summary><b>2026.9.19</b> · 2026-09-19 · Fix lost replies on long runs</summary>

The terminal full-card update exceeded Feishu's hard limits (>200 elements → 300305, >30KB → 200860), failed, and was swallowed, leaving a frozen streaming card (61 tool calls → 310 elements in the field); the terminal card now degrades within the limits (tool steps folded into a “N more steps not shown” notice, reasoning panel clipped/dropped, tool output clipped, answer clipped as a last resort) and **the full reply is re-delivered as plain text whenever the card update fails or truncates the answer**. Also: after Feishu auto-closes streaming mode on its 10-minute cap (300309), the reply is no longer silently dropped. Added 17 card-budget/fallback tests (13 files / 120 tests).

</details>

<details>
<summary><b>2026.9.6</b> · 2026-09-06 · Fix silent inbound drop on multi-account</summary>

Fix inbound messages being silently dropped on OpenClaw 2.0 multi-account setups (`PreparedModelCatalogConfigReplacedError`): core dispatch now uses the untampered global config plus `usePublishedModelRuntime` (PR #1, by leothebravest); plumbed config through the comment / reaction / VC-invited paths and blocked `cfg: {}` dispatch; added 6 dispatch-config tests (11 files / 103 tests).

</details>

<details>
<summary><b>2026.9.4</b> · 2026-09-03 · Merged multi-image post</summary>

Added `channels.feishu.multiImageMode` (default `post`; `sequential` restores per-image sends; auto-fallback on any upload failure). (10 files / 97 tests)

</details>

<details>
<summary><b>2026.9.3</b> · 2026-09-02 · SSRF · PIN · test base</summary>

Full SSRF protection, PIN message actions, vitest test base (9 files / 78 tests); full security testing passed.

</details>

<details>
<summary><b>2026.9.2</b> · 2026-09-01 · ask_user fix · group streaming</summary>

Fix ask_user “Other” submit; remove `feishu_ask_user_question`; group streaming cards; tool dry-run script.

</details>

<details>
<summary><b>2026.9.1</b> · 2026-09-01 · OpenClaw 2.0 compat fixes</summary>

OpenClaw 2.0 compat fixes, built-in ask_user buttons, tool-activity display, ClawHub release.

</details>

<details>
<summary><b>2026.8.1</b> · 2026-08-31 · Initial 2.0 adaptation branch</summary>

Initial 2.0 adaptation branch.

</details>

---

## Development

```bash
npm install            # install deps (incl. vitest)
npm test               # run the vitest test suite
npm run test:watch     # watch mode
```

The plugin is CommonJS source (`src/` + `index.js` entry) with no build step — sync to the OpenClaw extensions directory and restart the gateway to apply changes.

---

## Credits & License

Forked from [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) (MIT). MIT licensed.

<div align="center"><sub>openclaw-lark-2 · OpenClaw 2.0 · Feishu / Lark</sub></div>

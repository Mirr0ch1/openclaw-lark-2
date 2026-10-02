<div align="center">

# openclaw-lark-2

**An OpenClaw 2.0-native Feishu / Lark channel plugin**

An independent fork of `@larksuite/openclaw-lark`, fully adapted to the OpenClaw 2.0 SDK.

[![OpenClaw](https://img.shields.io/badge/OpenClaw-%E2%89%A52026.8.1-3b82f6?style=flat-square)](#installation)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-126%20passing-22c55e?style=flat-square)](#development)
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

### Security & Engineering

- **Full SSRF coverage**: all outbound HTTP goes through the SDK `fetchWithSsrFGuard` — DNS pinning (anti-rebinding), IPv4+IPv6 private/reserved-address blocking, per-hop redirect validation, hostname allowlist.
- **Test base**: a vitest suite (`npm test`) covering core security and routing paths.
- **Plugin Inspector report**: `clawhub package validate` with 0 warnings.

---

## Installation

### via ClawHub

```bash
openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2
```

### via tarball (local dev)

```bash
npm pack
openclaw plugins install openclaw-lark-2-2026.10.2.tgz
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
    },
  },
  plugins: {
    allow: ["openclaw-lark-2"],
  },
}
```

> **Scope tip**: the Feishu app needs the `cardkit:card:write` scope enabled in the Open Platform for streaming cards to work.

---

## Three-Way Comparison

This plugin takes the best of both worlds: the complete tool surface of ByteDance's `@larksuite/openclaw-lark`, the OpenClaw 2.0-native architecture and security engineering of the official `@openclaw/feishu`, plus features neither has.

| Dimension | **openclaw-lark-2 (ours)** | **@openclaw/feishu (official 2.0)** | **@larksuite/openclaw-lark 7.16 (ByteDance)** |
|---|:---:|:---:|:---:|
| Version | **2026.10.2** | 2026.8.1 | 2026.7.16 |
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
| Dual-channel webhook | ❌ WebSocket only | ✅ WS + webhook | ❌ |
| Test suite | ✅ **vitest base (14 files / 126 tests)** | ✅ 99 files / 1202 tests | ❌ none |
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
| Dual-channel webhook | Not yet implemented (like ByteDance), WebSocket only; the official supports WS + webhook. |
| PIN actions | Supported here; missing in ByteDance 7.16. |
| Test scale | Minimal base (126 tests), far smaller than the official (1202), but covers core security & routing paths. |
| Tool-display toggle | Toggle via `toolUseDisplay.enabled:false`; on by default. |

---

## Changelog

<details open>
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

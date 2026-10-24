# openclaw-lark-2

> Feishu / Lark channel plugin · native OpenClaw 2.0
>
> Forked from Feishu's official `@larksuite/openclaw-lark` to finish what it left undone:
> **OpenClaw 2.0 support · a far wider surface than the OpenClaw official plugin · and making lark-cli actually usable for multiple Feishu bots.**

## Table of Contents

- [Why this project exists](#why-this-project-exists)
- [Three headline advantages](#three-headline-advantages)
- [Three-way comparison](#three-way-comparison)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [The 2026.10 refactor](#the-202610-refactor)
- [Migrating from 38 tools](#migrating-from-38-tools)
- [Changelog](#changelog)

---

## Why this project exists

In July 2026 Feishu open-sourced `@larksuite/openclaw-lark` — 39 tools, the most complete Feishu surface at the time.

It has one hard problem: **its plugin API is stuck on OpenClaw 1.x** (`loadConfig`). OpenClaw 2.0 replaced the plugin model (`runtime.config.current()`, `registerTool`, `agentPrompt`, channel actions), and **upstream has not followed since 2026.7.16** — on 2.0 that line is simply broken: it does not install, and nobody is picking it up.

This fork continues that surface while adding everything 2.0 expects.

By 2026.10 the project became something else: **Feishu capability is no longer implemented by the plugin — it comes from `lark-cli`; the plugin owns the channel, identity and authorization.** The result is not "less capability": domain coverage went from 10 to **23**, while per-turn context went from ~20k tokens to **479 characters**.

---

## Three headline advantages

### 1. Full OpenClaw 2.0 support (the half upstream never did)

| 2.0 mechanism | This project | Upstream `@larksuite/openclaw-lark` |
|---|---|---|
| Plugin entry | `register()` + `runtime.config.current()` | `loadConfig()` (1.x) |
| Tool registration | `registerTool` / `registerCommand` | 1.x tool table |
| Per-turn context injection | `agentPrompt.inboundFormattingHints({cfg, accountId})` | none (`alwaysActive` is a no-op field on 2.0) |
| Channel message actions | implements `feishuMessageActions`, wired into core's `message` tool | none |
| Card action callbacks | full `card.action.trigger` chain (ask_user buttons, inject_prompt) | partial |
| Host primitives | `plugin-sdk/*` (344 subpaths since 10.2): durable ingress, thread bindings, webhook, retry | none |

**Why it matters**: on OpenClaw 2.0, upstream is not "a bit worse" — it does not install. This project is the only continuation of that line that runs.

### 2. A much wider surface than the OpenClaw official plugin

`@openclaw/feishu` is "good enough": 14 tools covering doc / drive / wiki / chat / perm / bitable, and **no calendar, task or sheets**.

This project covers **23 domains** (docs / sheets / base / drive / im / task / calendar / wiki / contact / approval / mail / minutes / vc / okr / slides / whiteboard / markdown / mindnotes / note / event / attendance / apps / application) with 28 bundled domain skills loaded on demand.

On the channel side:

| Capability | This project | `@openclaw/feishu` |
|---|---|---|
| Inbound message converters | **22 kinds** | partial |
| Group streaming card | **✅ `replyMode.group:"streaming"`** | ✅ |
| Multi-image merged post | **✅ default** | ❌ one by one |
| Built-in `ask_user` button card | **✅ button + free-form answer + all group members** | ❌ text fallback |
| Tool-step display | **✅ on by default** | ⚠️ verbose/preview only |
| PIN / unpin | **✅** | ✅ |
| Durable ingress queue | **✅ opt-in** | ✅ on by default |
| Full egress SSRF guard | **✅ DNS pinning + private-net block + redirect checks** | ✅ CardKit/registration only |

### 3. Built around lark-cli — and it fills a gap lark-cli has

`lark-cli` is Feishu's official CLI: 23 domains, 28 domain skills, lazy `schema` lookup, risk levels. But it has a structural limit:

> **It is single-profile.** `profile use` flips process-global state — one Feishu app (bot) at a time.

So **one OpenClaw gateway serving several Feishu bots is impossible with lark-cli alone.** This project adds three layers to make it a real multi-bot execution layer:

1. **Per-call identity**: one lark-cli profile per account, selected with `--profile <account>` (per invocation, not a global switch).
2. **Per-turn injection**: the plugin states which account this conversation belongs to (122 characters), so the model never guesses.
3. **Command-line enforcement**: `bin/feishu-lark` fails without `--profile`, refuses `profile use` and other global commands, and fences stdout.

Result: **one gateway, many Feishu bots, no cross-account writes** — and capability tracks the CLI: `npm i -g @larksuite/cli` brings new domains without waiting for a plugin release.

---

## Three-way comparison

| Dimension | **openclaw-lark-2** | **@openclaw/feishu** (OpenClaw) | **@larksuite/openclaw-lark** (Feishu) |
|---|:---:|:---:|:---:|
| Origin | fork of Feishu 7.16, rewritten for 2.0 | OpenClaw in-house | Feishu open source (no 2.0 follow-up since 2026.7.16) |
| OpenClaw 2.0 | **✅ native 2.0 SDK** | ✅ native 2.0 | ❌ 1.x `loadConfig`, cannot load |
| Surface | **23 domains (lark-cli)** | ~6 domains / 14 tools | 10 domains / 39 tools |
| Delivery | **CLI on demand + 28 domain skills** | resident tools | resident tools |
| Per-turn context | **479 chars** | 14 tools' schema | 39 tools' schema |
| Multi-bot / multi-account | **✅ `--profile` per call, enforced** | ✅ `accountId` param | ❌ |
| Wrong-account protection | **✅ fails without a profile** | ⚠️ caller's job | ❌ |
| Capability upgrade | **`npm i -g @larksuite/cli`** | wait for a release | wait for a release |
| User authorization | **✅ in-chat card + `feishu_auth`** | ❌ | ✅ |
| exec output fencing | **✅ wrapper** | — | — |
| Group streaming card | **✅** | ✅ | ❌ static by default |
| Multi-image post | **✅ default** | ❌ | ❌ |
| `ask_user` button card | **✅** | ❌ | ❌ |
| Tool-step display | **✅ default on** | ⚠️ verbose | ⚠️ verbose |
| Diagnostics | **✅ `/feishu doctor`, `/feishu larkcli status`** | ✅ | ⚠️ |
| Tests | **✅ 61 files / 485 cases** | ✅ 99 files / 1202 cases | ❌ none |

> Rule of thumb: **zero extra installs** → `@openclaw/feishu`. **Full Feishu surface on OpenClaw 2.0 with multiple bots and stable long tasks** → this project.

---

## Architecture

~~~text
┌─ Channel layer (plugin) ───────────────────────────┐
│ send/receive · cards · streaming · ask_user · media │
│ dedupe · durable ingress · rate-limit retry · footer│
└─────────────────────────────────────────────────────┘
┌─ Identity envelope (plugin) ───────────────────────┐
│ accountId → lark-cli profile (122 chars per turn)   │
│ bin/feishu-lark: require profile · block globals ·  │
│                   fence untrusted output            │
└─────────────────────────────────────────────────────┘
┌─ Capability layer (lark-cli) ──────────────────────┐
│ 23 domains · 28 domain skills · lazy schema · risk  │
└─────────────────────────────────────────────────────┘
~~~

---

## Quick start

Requirements: OpenClaw ≥ 2026.8.1, `lark-cli` (`npm i -g @larksuite/cli`), exec enabled for the agent.

~~~bash
openclaw plugins install clawhub:@mirr0ch1/openclaw-lark-2 --accept-capabilities
openclaw config set channels.feishu.appId cli_xxx
openclaw config set channels.feishu.appSecret xxx
# then in Feishu: /feishu larkcli sync   (idempotent; adopts existing profiles)
#                  /feishu larkcli status
~~~

---

## Configuration

~~~jsonc
{
  "channels": {
    "feishu": {
      "appId": "cli_main",
      "appSecret": "xxx",
      "accounts": {
        "plaud":     { "appId": "cli_a", "appSecret": "xxx" },
        "hdwriting": { "appId": "cli_b", "appSecret": "xxx" }
      },
      "larkCli": {
        "enabled": "auto",     // auto (default) | true | false
        "prompt": "minimal",   // minimal (default) | compact | full | off
        "binaryPath": ""
      }
    }
  }
}
~~~

Account id doubles as the lark-cli profile name; if that appId is already bound under another name the plugin adopts it (lark-cli forbids two profiles per appId).

---

## The 2026.10 refactor

The sections above describe *what this project is*. This one describes *what changed recently*. **Motivation**: the plugin's own skills already said "these `feishu_*` tools are deprecated", yet every turn still injected ~20k tokens of their schema — the model was told "you have this capability" and "don't use it" at once. Removing tools is not cutting capability; it is putting capability where it belongs.

| | Before (2026.10.9) | After (2026.10.10) |
|---|---|---|
| Registered tools | **38** | **1** (`feishu_auth`) |
| Per-turn tool schema | 67,206 chars ≈ 18–21k tokens | **479 chars** (−99.3%) |
| Per-turn identity hint | — | **122 chars** (`minimal`, can be disabled) |
| Bundled skills | 8 / 538 lines | **3 / 218 lines** |
| Domain coverage | 10 (self-implemented) | **23** (lark-cli, on demand) |
| Tool-layer code | `src/tools` 12,098 lines | **662 lines** (−94%) |
| Multi-account | one `accountId` per tool | **`--profile` per call** + injection |
| User authorization | plugin-owned UAT store | **lark-cli device flow** + in-chat card |
| Result fencing | plugin tools only | **wrapper-level** (covers exec) |

Three things worth calling out:

1. **Identity became an envelope**: account → profile is injected per turn and enforced by `bin/feishu-lark` — writing into the wrong app stops being possible rather than unlikely.
2. **The exec fencing gap is closed**: core fences web_fetch / directory / tool-error output but **not exec stdout**; with capability moving to a CLI, the wrapper is the only place that boundary can live (`--no-fence` for jq/python).
3. **Authorization is one tap again**: lark-cli's device flow becomes a Feishu card with a button and a copyable code — the one thing a CLI cannot do in a chat, and the only tool left.

---

## Migrating from 38 tools

| Old tool | Now |
|---|---|
| `feishu_create_doc` / `fetch_doc` / `update_doc` | `feishu-lark --profile <p> docs +create / +fetch / +update` |
| `feishu_bitable_*` / `calendar_*` / `task_*` | `feishu-lark … base / calendar / task …` |
| `feishu_im_user_*` | `feishu-lark … im +messages-search / +chat-messages-list` |
| `feishu_im_user_message` | `feishu-lark … im +messages-send` (or core `message` tool as bot) |
| `feishu_drive_file` / `sheet` / `wiki_*` / `get_user` / `chat*` | `feishu-lark … drive / sheets / wiki / contact / im …` |
| `feishu_oauth` / `oauth_batch_auth` | **`feishu_auth`** (the only remaining tool) |

The `feishu-cli` skill carries the routing table; details come from `lark-cli <domain> --help` or `lark-cli skills read lark-<domain>`.

> Upgrading from ≤2026.10.9: clear `feishu_*` entries from `agents.*.tools.alsoAllow` — those tools no longer exist.

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

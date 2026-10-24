# openclaw-lark-2

> Feishu / Lark channel plugin · native OpenClaw 2.0 · **2026.10 refactor**
>
> **One line**: business capability goes to `lark-cli`; identity and context stay in the plugin — 38 tools collapsed into 1.

## Table of Contents

- [What changed](#what-changed)
- [Why choose it](#why-choose-it)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Migrating from 38 tools](#migrating-from-38-tools)
- [Changelog](#changelog)

---

## What changed

**Motivation in one sentence**: the plugin's own skills already said "these `feishu_*` tools are deprecated", yet every turn still injected ~20k tokens of their schema — the model was told "you have this capability" and "don't use it" at the same time. Removing tools is not cutting capability; it is putting capability where it belongs.

| | Before (2026.10.9) | After |
|---|---|---|
| Registered tools | **38** | **1** (`feishu_auth`) |
| Per-turn tool schema | 67,206 chars ≈ 18–21k tokens | **479 chars** (−99.3%) |
| Per-turn identity hint | — | **122 chars** (`minimal`, can be disabled) |
| Bundled skills | 8 / 538 lines | **3 / 218 lines** |
| Domain coverage | 10 (self-implemented) | **23 domains / 28 domain skills** (via `lark-cli`, loaded on demand) |
| Tool-layer code | `src/tools` 12,098 lines | **662 lines** (−94%) |
| Multi-account | one `accountId` param per tool | **`--profile` per call** + per-turn injection |
| User authorization | plugin-owned UAT store | **lark-cli device flow** + in-chat card |
| Result fencing | plugin tools only | **wrapper-level** (covers exec too) |

### Three things worth calling out

1. **Identity became an envelope, not a parameter.** Multi-account is not "pass one more argument"; it is "which Feishu app does this call belong to". The plugin injects the conversation's account → profile once per turn, and `bin/feishu-lark` enforces it at the command line: **no `--profile`, no call**. Writing into the wrong app stops being possible rather than unlikely.
2. **The fencing gap over exec is closed.** Core fences web_fetch / directory / tool-error output, but **not exec stdout**. Once Lark work moves to a CLI, that boundary would vanish — so the wrapper fences by default and `--no-fence` exists for jq/python.
3. **Authorization is one tap again.** lark-cli's device flow was designed for harnesses that can only send a final message (`--no-wait` + `--device-code`). The plugin turns it into a Feishu card with a button and a copyable code. That is the one thing a CLI cannot do inside a chat — and the only tool left.

---

## Why choose it

### Three different things

| | Positioning | Your cost |
|---|---|---|
| **openclaw-lark-2** | **Channel engineering + identity layer**; capability delegated to `lark-cli` | needs `lark-cli` + exec permission |
| **@openclaw/feishu** (OpenClaw official) | 14 bundled tools, zero external deps | narrower coverage, fixed per-turn schema cost |
| **@larksuite/openclaw-lark** (Feishu official) | 39 bundled tools, widest surface | 39 tools always resident, 1.x plugin API (does not load on 2.0), no per-call account |

Pick **@openclaw/feishu** if you want zero extra installs. Pick **this plugin** if you want the best Feishu channel behaviour, multi-account safety, and stable long tasks.

### Side by side

| Dimension | **openclaw-lark-2** | **@openclaw/feishu** (2026.8.1) | **@larksuite/openclaw-lark** (7.16) |
|---|:---:|:---:|:---:|
| OpenClaw compatibility | **≥2026.8.1 (2.0 SDK)** | ≥2026.8.1 | ≥2026.5.4 (1.x API) |
| Contract tools | **1** | 14 | 39 |
| Domain coverage | **23 (via lark-cli)** | ~6 | 10 |
| Per-turn schema cost | **≈0.5k chars** | 14 tools' worth | 39 tools' worth |
| Per-call account selection | **✅ `--profile` (enforced)** | ✅ `accountId` | ❌ |
| Wrong-account protection | **✅ fails without a profile** | ⚠️ caller's responsibility | ❌ |
| Capability upgrade path | **`npm i -g @larksuite/cli`** | wait for a release | wait for a release |
| User authorization (device flow) | **✅ in-chat card + `feishu_auth`** | ❌ | ✅ |
| exec output fencing | **✅ wrapper** | — | — |
| Streaming replies (CardKit) | **✅ DM + group** | ✅ | ✅ (needs `streaming:true`) |
| Group streaming card | **✅ `replyMode.group:"streaming"`** | ✅ | ❌ static by default |
| Multi-image merged post | **✅ default** | ❌ one by one | ❌ one by one |
| Built-in `ask_user` button card | **✅ button + free-form answer + all group members** | ❌ text fallback | ❌ own tool |
| Tool-step display | **✅ on by default** | ⚠️ verbose/preview only | ⚠️ verbose only |
| Durable ingress queue | **✅ opt-in** | ✅ on by default | ❌ |
| SSRF protection | **✅ full egress** | ✅ CardKit/registration only | ⚠️ hand-rolled IPv4 |
| Diagnostics | **✅ `/feishu doctor`, `/feishu larkcli status`** | ✅ | ⚠️ |
| Test suite | **✅ 61 files / 485 cases** | ✅ 99 files / 1202 cases | ❌ none |

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

Account id doubles as the lark-cli profile name; if that appId is already bound under another name, the plugin adopts it (lark-cli forbids two profiles per appId).

---

## Migrating from 38 tools

Nothing you used is gone — it moved:

| Old tool | Now |
|---|---|
| `feishu_create_doc` / `fetch_doc` / `update_doc` | `feishu-lark --profile <p> docs +create / +fetch / +update` |
| `feishu_bitable_*`, `feishu_calendar_*`, `feishu_task_*` | `feishu-lark … base / calendar / task …` |
| `feishu_im_user_*` | `feishu-lark … im +messages-search / +chat-messages-list` |
| `feishu_drive_file` / `sheet` / `wiki_*` / `get_user` / `chat*` | `feishu-lark … drive / sheets / wiki / contact / im …` |
| `feishu_oauth` / `oauth_batch_auth` | **`feishu_auth`** (the only remaining tool) |

The model does not need to be taught the mapping: the `feishu-cli` skill carries the routing table, and `lark-cli <domain> --help` / `lark-cli skills read lark-<domain>` carry the details.

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

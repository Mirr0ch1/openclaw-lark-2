# OpenClaw 2026.10+ compatibility notes

Diagnostic record for the fix in `fix/openclaw-2026.10.1-sdk-compat`.

Written from a live incident: OpenClaw host upgraded 2026.9.9 → 2026.10.1, after
which this plugin failed to load and the Feishu channel went fully unavailable.

---

## 1. Symptom

The plugin throws at load and never starts:

```
[plugins] openclaw-lark-2 failed during load from .../feishu/index.js:
  Plugin openclaw-lark-2 cannot import openclaw/plugin-sdk/command-auth
  (built with OpenClaw 2026.8.1; running core 2026.10.1)
  [Error [ERR_PACKAGE_PATH_NOT_EXPORTED]:
   Package subpath './plugin-sdk/command-auth' is not defined by "exports"]
```

Observed on the host startup log:

```
http server listening (4 plugins: exa, memory-core, openclaw-weixin, tavily)
```

`openclaw-lark-2` is simply absent from that list. The channel never starts.

### Do not trust the channel status table

`openclaw status` reports:

```
│ openclaw-lark-2 │ ON │ OK │ configured │
```

**This is misleading.** That table reads configuration, not live load state. While
the plugin was completely broken it still showed `ON / OK / configured`.

Use the startup log line `http server listening (... plugins: ...)` as the
authority for whether a plugin actually loaded.

---

## 2. Diagnosis

Run these **from the plugin directory**. This matters — see §6.

```bash
cd ~/.openclaw/extensions/feishu

# Enumerate every plugin-sdk subpath the plugin imports, and test each one.
grep -rhoE 'require\("openclaw/plugin-sdk/[a-z0-9-]+"\)' src/ index.js \
  | sed -E 's/require\("openclaw\/plugin-sdk\///; s/"\)//' | sort -u > /tmp/refs.txt

while read -r p; do
  node -e "require('openclaw/plugin-sdk/$p')" 2>/dev/null \
    && echo "  OK  $p" || echo "  FAIL $p"
done < /tmp/refs.txt
```

On 2026.10.1 this reports three failures:

```
FAIL channel-message
FAIL command-auth
FAIL config-runtime
```

**Enumerate all of them.** Grepping for the first one and patching it is not
enough — this incident had three, and fixing only the one surfaced by the error
message leaves the plugin still dead.

---

## 3. Root cause

OpenClaw 2026.10 retired three `plugin-sdk` subpaths this plugin imported.

| Retired subpath | Replacement on 2026.10.1 | Nature of change |
|---|---|---|
| `plugin-sdk/channel-message` | `plugin-sdk/channel-outbound` | clean 1:1 move |
| `plugin-sdk/config-runtime` | `plugin-sdk/session-store-runtime` | API reshaped |
| `plugin-sdk/command-auth` | *no direct replacement* | **needs rebuild** |

### channel-message → channel-outbound

Both symbols used by this plugin moved verbatim:

- `createReplyPrefixContext` — present in `channel-outbound`
- `createTypingCallbacks` — present in `channel-outbound`

### config-runtime → session-store-runtime

The plugin used three symbols to read a session's `verboseLevel`. Two of them no
longer exist anywhere in the 2026.10.1 bundle:

```
resolveStorePath          -> still exported by session-store-runtime
loadSessionStore          -> gone
resolveSessionStoreEntry  -> gone
```

They are replaced by the scope-based `getSessionEntry({ agentId, sessionKey })`,
which returns the projected entry directly (or `undefined`), so the
load-store-then-resolve-entry pair collapses into one call.

This path only drives verbose-mode display and is already wrapped in a
try/catch returning `undefined`, so the blast radius is cosmetic.

### command-auth — why this one cannot be renamed

`resolveSenderCommandAuthorization` is **absent from the entire 2026.10.1
bundle**, not merely unexported. Verified:

```bash
grep -rlE "resolveSenderCommandAuthorization" /usr/lib/node_modules/openclaw/dist/*.mjs
# no hits
```

Its 2026.8.1 type declaration carries the migration note:

```ts
/**
 * @deprecated Use `resolveChannelMessageIngress`
 *   from `openclaw/plugin-sdk/channel-ingress-runtime`.
 */
export declare function resolveSenderCommandAuthorization(params): Promise<{...}>
```

`resolveChannelMessageIngress` is a different architecture, not a rename. It is
built around ingress admission descriptors:

```js
// dist/runtime-*.mjs — the host's own composition
{
  channelId, accountId, identity, subject, conversation,
  contextBinding, event, policy, allowFrom, groupAllowFrom,
  route, routeFacts, accessGroups, accessGroupMembership,
  resolveAccessGroupMembership, readStoreAllowFrom, command
}
```

Substituting it into this call site would mean re-deriving identity/subject/
conversation/route for the Feishu channel — a redesign of the inbound path, not
a patch.

---

## 4. The fix

`src/messaging/inbound/command-auth-compat.js` rebuilds the removed helper from
primitives the host still exports, mirroring the host's own DM-branch
composition (visible in `dist/channel-inbound-*.mjs`):

```js
expandAllowFromWithAccessGroups            <- plugin-sdk/security-runtime
resolveDmGroupAccessWithLists              <- plugin-sdk/channel-policy
readChannelIngressStoreAllowFromForDmPolicy <- plugin-sdk/channel-ingress-runtime
```

`shouldComputeCommandAuthorized` and `resolveCommandAuthorizedFromAuthorizers`
are deliberately **not** imported. The host injects them per call via
`core.channel.commands.*`, and that runtime must be honoured rather than
re-derived.

Only `commandAuthorized` is consumed by this call site, so the shim reproduces
that field faithfully rather than reconstructing the whole old return shape.

### Fail-closed

Any error yields `commandAuthorized = false`. A defect in the shim can only ever
**deny** commands, never widen authorization.

```js
async function resolveSenderCommandAuthorization(params) {
    try {
        return await resolveSenderCommandAuthorizationImpl(params);
    } catch (error) {
        console.error("[feishu][command-auth-compat] denying command (fail-closed):", ...);
        return DENY; // commandAuthorized: false
    }
}
```

---

## 5. Verification

Against OpenClaw 2026.10.1.

**Functional** — 6/6:

| Case | Result | Expected |
|---|---|---|
| DM, sender in `allowFrom` | `true` | ✅ |
| DM, sender not listed | `false` | ✅ |
| group, sender in `groupAllowFrom` | `true` | ✅ |
| group, sender not listed | `false` | ✅ |
| non-command message | `undefined` | ✅ (auth not evaluated) |
| missing runtime params (fault injection) | `false` | ✅ fail-closed holds |

**Load** — all 21 referenced `plugin-sdk` subpaths resolve; 4 touched modules
load with zero failures.

**Production** — live Feishu channel on a real WebSocket connection:

```
starting feishu[default] (mode: websocket)
detected system command, using plain-text dispatch
system command dispatched (delivered=true)
```

DM command authorization confirmed in real traffic, not only in tests.

### Known gap

The **group** branch is a reconstruction. The DM branch was transcribed from the
host's own 2026.10.1 source; the group branch has no published host equivalent to
transcribe, so it was composed from the same primitives and covered by unit tests
only. It warrants a live group test before wide release.

---

## 6. Gotchas worth knowing

- **Always `cd` into the plugin directory before testing subpaths.** The plugin
  carries a private `node_modules/openclaw`. Running `node -e "require(...)"` from
  elsewhere puts `openclaw` off the resolution path and yields a misleading
  `MODULE_NOT_FOUND` that looks like "subpath missing" when the subpath is fine.

- **Verify the layout marker.** `openclaw.plugin.json` still declares
  `build.openclawVersion: 2026.8.1`, so this drift recurs whenever the host moves
  past whatever the plugin was last built against.

- **A local patch here will be overwritten** by `openclaw plugins update`. The
  durable fix has to land here, upstream.

---

## 7. Reproducing this for a future host bump

```bash
cd ~/.openclaw/extensions/feishu

# 1. enumerate + test every subpath
grep -rhoE 'require\("openclaw/plugin-sdk/[a-z0-9-]+"\)' src/ index.js \
  | sed -E 's/require\("openclaw\/plugin-sdk\///; s/"\)//' | sort -u \
  | while read -r p; do
      node -e "require('openclaw/plugin-sdk/$p')" 2>/dev/null \
        && echo "  OK  $p" || echo "  FAIL $p"
    done

# 2. for each FAIL, find where its symbols moved
jq -r '.exports | keys[]' /usr/lib/node_modules/openclaw/package.json \
  | grep plugin-sdk | grep -iE "<keyword>"

# 3. confirm whether the symbol itself survived anywhere
grep -rlE "<symbolName>" /usr/lib/node_modules/openclaw/dist/plugin-sdk/*.d.ts
```
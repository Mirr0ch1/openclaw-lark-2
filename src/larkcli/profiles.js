"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Account -> lark-cli profile plumbing.
 *
 * The plugin no longer owns Lark business capability: lark-cli does, and it
 * does it better (23 domains, 28 bundled skills, lazy schema lookup, risk
 * levels, --dry-run). What lark-cli cannot know is *which Feishu app the
 * current conversation belongs to* — that fact lives here, in the channel.
 *
 * Two hard-won facts drive the design (2026-10-24, verified against 1.0.97):
 *
 * 1. lark-cli keeps TWO config stores. Once an OpenClaw binding exists
 *    (~/.lark-cli/openclaw/config.json), ANY process with a non-empty
 *    OPENCLAW_HOME reads that store and does NOT fall back to the global one.
 *    The exec tool always sets OPENCLAW_HOME, so the bound store is the only
 *    one the agent can see. Provisioning into the global store is invisible to
 *    the agent — every call then fails with 'profile not found'.
 *    => every lark-cli spawn here pins OPENCLAW_HOME to the same value.
 *
 * 2. A profile name is not free: lark-cli rejects two profiles with the same
 *    appId ("each profile must have a unique app-id"). An OpenClaw account may
 *    already be bound under its appId as the profile name, so the mapping is
 *    resolved, not assumed, and cached for the per-turn prompt path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRAPPER_RELATIVE_PATH = void 0;
exports.openclawHome = openclawHome;
exports.wrapperPath = wrapperPath;
exports.ensureStableWrapper = ensureStableWrapper;
exports.profileNameFor = profileNameFor;
exports.resolveProfileName = resolveProfileName;
exports.isLarkCliEnabled = isLarkCliEnabled;
exports.resolveLarkCliBinary = resolveLarkCliBinary;
exports.listProfiles = listProfiles;
exports.provisionProfiles = provisionProfiles;
exports.healthCheck = healthCheck;
exports.buildIdentityRules = buildIdentityRules;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_os_1 = require("node:os");
const accounts_1 = require("../core/accounts.js");
const lark_logger_1 = require("../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('larkcli/profiles');
const SPAWN_TIMEOUT_MS = 20000;
exports.WRAPPER_RELATIVE_PATH = 'bin/feishu-lark';
/** OpenClaw home as the exec tool sees it (the switch lark-cli keys on). */
function openclawHome() {
    const explicit = (process.env.OPENCLAW_HOME || '').trim();
    if (explicit)
        return explicit;
    return (0, node_path_1.join)((0, node_os_1.homedir)() || process.env.HOME || '', '.openclaw');
}
/**
 * Stable, load-bearing copy of the wrapper.
 *
 * The plugin may be loaded from anywhere the host materialises it — an npm
 * cache, a ClawHub install dir, or a temp 'plugin-captures' build dir that is
 * garbage-collected later. A path inside that tree is not something to write
 * into the model's instructions, so the wrapper is mirrored into
 * $OPENCLAW_HOME/bin and that copy is what the prompt points at.
 */
function stableWrapperPath() {
    return (0, node_path_1.join)(openclawHome(), 'bin', 'feishu-lark');
}
function packageWrapperPath() {
    return (0, node_path_1.join)(__dirname, '..', '..', exports.WRAPPER_RELATIVE_PATH);
}
/** The wrapper path to advertise: the stable mirror when present. */
function wrapperPath() {
    const stable = stableWrapperPath();
    try {
        (0, node_fs_1.accessSync)(stable, node_fs_1.constants.X_OK);
        return stable;
    }
    catch {
        return packageWrapperPath();
    }
}
/**
 * Mirror the packaged wrapper into $OPENCLAW_HOME/bin when missing or stale.
 * Idempotent and cheap (one read + compare), safe to call on every register().
 */
function ensureStableWrapper() {
    const source = packageWrapperPath();
    const target = stableWrapperPath();
    try {
        const src = (0, node_fs_1.readFileSync)(source);
        let current = null;
        try {
            current = (0, node_fs_1.readFileSync)(target);
        }
        catch {
            current = null;
        }
        if (current && current.equals(src)) {
            (0, node_fs_1.chmodSync)(target, 0o755);
            return target;
        }
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
        (0, node_fs_1.writeFileSync)(target, src, { mode: 0o755 });
        (0, node_fs_1.chmodSync)(target, 0o755);
        log.info('installed stable wrapper at ' + target);
        return target;
    }
    catch (err) {
        log.warn('ensureStableWrapper failed: ' + (err instanceof Error ? err.message : String(err)));
        return source;
    }
}
/** Normalise an accountId into a candidate lark-cli profile name. */
function profileNameFor(accountId) {
    const raw = String(accountId ?? '').trim().toLowerCase();
    if (!raw)
        return 'default';
    const safe = raw.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return safe || 'default';
}
/** Where resolved accountId -> profile names are cached for the prompt path. */
function resolutionPath() {
    return (0, node_path_1.join)(openclawHome(), 'lark-2', 'larkcli-profiles.json');
}
function readResolutionCache() {
    try {
        const raw = (0, node_fs_1.readFileSync)(resolutionPath(), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeResolutionCache(map) {
    const target = resolutionPath();
    try {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
        (0, node_fs_1.writeFileSync)(target, JSON.stringify(map, null, 2) + '\n');
    }
    catch (err) {
        log.warn('failed to persist profile resolution: ' + (err instanceof Error ? err.message : String(err)));
    }
}
/** Read the plugin-level larkCli config block (never throws). */
function larkCliConfig(cfg, accountId) {
    const section = cfg && cfg.channels && cfg.channels.feishu;
    if (!section || typeof section !== 'object')
        return {};
    const accountBlock = accountId && section.accounts && section.accounts[accountId]
        ? section.accounts[accountId].larkCli
        : undefined;
    return { ...(section.larkCli || {}), ...(accountBlock || {}) };
}
/** Locate the lark-cli binary: config override, then PATH, then common prefixes. */
function resolveLarkCliBinary(cfg, accountId) {
    const config = larkCliConfig(cfg, accountId);
    const explicit = typeof config.binaryPath === 'string' ? config.binaryPath.trim() : '';
    if (explicit) {
        return (0, node_fs_1.existsSync)(explicit) ? explicit : null;
    }
    const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
    const home = process.env.HOME || (0, node_os_1.homedir)() || '';
    const dirs = [
        ...(process.env.PATH || '').split(node_path_1.delimiter),
        (0, node_path_1.join)(home, '.npm-global', 'bin'),
        (0, node_path_1.join)(home, '.local', 'bin'),
        '/usr/local/bin',
    ].filter(Boolean);
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = (0, node_path_1.join)(dir, 'lark-cli' + ext);
            try {
                (0, node_fs_1.accessSync)(candidate, node_fs_1.constants.X_OK);
                return candidate;
            }
            catch {
                /* keep looking */
            }
        }
    }
    return null;
}
/**
 * Whether the CLI-delegation path is active for this account.
 *
 * enabled: true forces it on (useful to surface the wrapper's install hint),
 * false turns it off, and the default 'auto' follows binary discovery — a host
 * without lark-cli never pays for the injected rules.
 */
function isLarkCliEnabled(cfg, accountId) {
    const config = larkCliConfig(cfg, accountId);
    if (config.enabled === false)
        return false;
    if (config.enabled === true)
        return true;
    return resolveLarkCliBinary(cfg, accountId) !== null;
}
function run(bin, args, opts) {
    const options = opts || {};
    const res = (0, node_child_process_1.spawnSync)(bin, args, {
        encoding: 'utf8',
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        input: options.input,
        // Pin OPENCLAW_HOME so plugin-side calls read the same store as the
        // agent's exec calls (see the header note).
        env: { ...process.env, OPENCLAW_HOME: openclawHome() },
    });
    return {
        status: typeof res.status === 'number' ? res.status : res.signal ? 1 : 0,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        error: res.error ? res.error.message : undefined,
    };
}
/** Parse the JSON emitted by 'lark-cli profile list'. */
function listProfiles(cfg) {
    const bin = resolveLarkCliBinary(cfg);
    if (!bin)
        return { ok: false, profiles: [], error: 'lark-cli not found' };
    const res = run(bin, ['profile', 'list']);
    if (res.status !== 0) {
        return { ok: false, profiles: [], error: (res.stderr || res.stdout || 'profile list failed').trim() };
    }
    try {
        const parsed = JSON.parse(res.stdout);
        const profiles = Array.isArray(parsed) ? parsed : [];
        return {
            ok: true,
            profiles: profiles
                .filter((p) => p && typeof p === 'object')
                .map((p) => ({
                name: String(p.name || ''),
                appId: String(p.appId || ''),
                active: p.active === true,
            })),
        };
    }
    catch (err) {
        return { ok: false, profiles: [], error: 'profile list returned non-JSON: ' + err.message };
    }
}
/**
 * Resolve the profile name for an account.
 *
 * Pure (cache-backed) so it is safe on the per-turn prompt path. Preference:
 *   1. cached resolution whose appId still matches the account
 *   2. the accountId itself (the normal case, provisioned by us)
 * Anything else is corrected by provisionProfiles(), which rewrites the cache.
 */
function resolveProfileName(cfg, accountId) {
    const accountInfo = accountId ? (0, accounts_1.getLarkAccount)(cfg, accountId) : null;
    const expectedAppId = accountInfo && accountInfo.appId ? accountInfo.appId : undefined;
    const cache = readResolutionCache();
    const cachedName = accountInfo ? cache[accountInfo.accountId] : undefined;
    if (cachedName && typeof cachedName.profile === 'string') {
        if (!expectedAppId || cachedName.appId === expectedAppId)
            return cachedName.profile;
    }
    return profileNameFor(accountId);
}
function backupCliConfig() {
    const home = process.env.HOME || (0, node_os_1.homedir)() || '';
    // Both stores matter: the bound one (~/.lark-cli/openclaw) is what exec
    // reads, the global one is what a plain shell reads.
    const candidates = [
        (0, node_path_1.join)(home, '.lark-cli', 'openclaw', 'config.json'),
        (0, node_path_1.join)(home, '.lark-cli', 'config.json'),
    ];
    for (const configPath of candidates) {
        if (!(0, node_fs_1.existsSync)(configPath))
            continue;
        const target = configPath + '.bak-lark-2-' + Date.now();
        try {
            (0, node_fs_1.copyFileSync)(configPath, target);
            return target;
        }
        catch (err) {
            log.warn('failed to back up lark-cli config: ' + (err instanceof Error ? err.message : String(err)));
        }
    }
    return undefined;
}
/**
 * Create/repair one lark-cli profile per configured account, in the store the
 * agent actually reads, and persist the resolved mapping.
 *
 * Idempotent: an existing profile with the matching appId is adopted (whatever
 * its name — lark-cli forbids two profiles per appId); a name collision with a
 * different appId is only rewritten when force is set.
 */
function provisionProfiles(cfg, opts) {
    const options = opts || {};
    const bin = resolveLarkCliBinary(cfg);
    const result = { ok: true, created: [], updated: [], adopted: [], skipped: [], failed: [], backup: undefined };
    if (!bin) {
        result.ok = false;
        result.failed.push({ accountId: '*', error: 'lark-cli not found on PATH' });
        return result;
    }
    const accounts = (0, accounts_1.getEnabledLarkAccounts)(cfg);
    if (accounts.length === 0) {
        result.ok = false;
        result.failed.push({ accountId: '*', error: 'no configured+enabled Feishu accounts' });
        return result;
    }
    const existing = listProfiles(cfg);
    if (!existing.ok) {
        result.ok = false;
        result.failed.push({ accountId: '*', error: existing.error || 'profile list failed' });
        return result;
    }
    const addProfile = (account, name) => {
        const args = ['profile', 'add', '--name', name, '--app-id', account.appId, '--app-secret-stdin'];
        if (account.brand === 'lark')
            args.push('--brand', 'lark');
        // The secret goes over stdin, never argv: argv is world-readable in ps.
        return run(bin, args, { input: String(account.appSecret || '') + '\n' });
    };
    // A profile row can survive while its credentials are gone (e.g. a
    // 'profile remove' of the same appId from the other store clears the shared
    // secret). whoami is the only truthful probe, and repair is safe precisely
    // because not_configured means there is no user token to lose.
    const needsCredentialRepair = (name) => {
        const who = run(bin, ['--profile', name, 'whoami']);
        if (who.status !== 0)
            return false;
        try {
            const parsed = JSON.parse(who.stdout);
            return parsed && parsed.tokenStatus === 'not_configured';
        }
        catch {
            return false;
        }
    };
    const resolution = {};
    for (const account of accounts) {
        const preferred = profileNameFor(account.accountId);
        const byName = existing.profiles.find((p) => p.name === preferred);
        const byAppId = existing.profiles.find((p) => p.appId === account.appId);
        if (byName && byName.appId === account.appId) {
            if (needsCredentialRepair(preferred)) {
                result.backup = result.backup || backupCliConfig();
                run(bin, ['profile', 'remove', preferred]);
                const reAdded = addProfile(account, preferred);
                if (reAdded.status !== 0) {
                    result.failed.push({ accountId: account.accountId, error: 'credential repair failed: ' + (reAdded.stderr || reAdded.stdout).trim() });
                    continue;
                }
                result.repaired = result.repaired || [];
                result.repaired.push(preferred);
            }
            else {
                result.skipped.push(preferred);
            }
            resolution[account.accountId] = { profile: preferred, appId: account.appId };
            continue;
        }
        if (byAppId) {
            // Already bound under another name (e.g. the appId used as the name
            // by an earlier 'config bind'). Adopt it: lark-cli forbids a second
            // profile for the same appId.
            if (needsCredentialRepair(byAppId.name)) {
                result.backup = result.backup || backupCliConfig();
                run(bin, ['profile', 'remove', byAppId.name]);
                const reAdded = addProfile(account, byAppId.name);
                if (reAdded.status !== 0) {
                    result.failed.push({ accountId: account.accountId, error: 'credential repair failed: ' + (reAdded.stderr || reAdded.stdout).trim() });
                    continue;
                }
                result.repaired = result.repaired || [];
                result.repaired.push(byAppId.name);
            }
            else {
                result.adopted.push(account.accountId + ' -> ' + byAppId.name);
            }
            resolution[account.accountId] = { profile: byAppId.name, appId: account.appId };
            continue;
        }
        if (byName && byName.appId !== account.appId) {
            if (!options.force) {
                result.failed.push({
                    accountId: account.accountId,
                    error: 'profile ' + preferred + ' exists with appId ' + byName.appId + ' (config has ' + account.appId + '); re-run with force',
                });
                continue;
            }
            result.backup = result.backup || backupCliConfig();
            const removed = run(bin, ['profile', 'remove', preferred]);
            if (removed.status !== 0) {
                result.failed.push({
                    accountId: account.accountId,
                    error: 'profile remove failed: ' + (removed.stderr || removed.stdout).trim(),
                });
                continue;
            }
            const reAdded = addProfile(account, preferred);
            if (reAdded.status === 0) {
                result.updated.push(preferred);
                resolution[account.accountId] = { profile: preferred, appId: account.appId };
            }
            else
                result.failed.push({ accountId: account.accountId, error: (reAdded.stderr || reAdded.stdout).trim() });
            continue;
        }
        result.backup = result.backup || backupCliConfig();
        const added = addProfile(account, preferred);
        if (added.status === 0) {
            result.created.push(preferred);
            resolution[account.accountId] = { profile: preferred, appId: account.appId };
        }
        else
            result.failed.push({ accountId: account.accountId, error: (added.stderr || added.stdout).trim() });
    }
    writeResolutionCache(resolution);
    result.ok = result.failed.length === 0;
    return result;
}
/**
 * Per-account readiness report used by the doctor command.
 *
 * Detects the failure that configuration alone cannot: a profile that exists
 * but points at a different appId (e.g. after rotating an app in the console),
 * or a store mismatch that makes the agent unable to see a provisioned profile.
 */
function healthCheck(cfg) {
    const bin = resolveLarkCliBinary(cfg);
    const disabled = larkCliConfig(cfg).enabled === false;
    const accounts = (0, accounts_1.getEnabledLarkAccounts)(cfg);
    if (!bin) {
        return accounts.map((a) => ({
            accountId: a.accountId,
            profile: profileNameFor(a.accountId),
            ok: false,
            error: disabled ? 'larkCli disabled by config' : 'lark-cli not found on PATH',
        }));
    }
    const existing = listProfiles(cfg);
    return accounts.map((account) => {
        const name = resolveProfileName(cfg, account.accountId);
        const row = {
            accountId: account.accountId,
            profile: name,
            ok: false,
        };
        if (!existing.ok) {
            row.error = existing.error;
            return row;
        }
        const match = existing.profiles.find((p) => p.name === name) ||
            existing.profiles.find((p) => p.appId === account.appId);
        row.profileExists = Boolean(match);
        row.appIdMatch = match ? match.appId === account.appId : false;
        if (!match) {
            row.error = 'profile not provisioned (run /feishu larkcli sync)';
            return row;
        }
        if (!row.appIdMatch) {
            row.error = 'profile appId ' + match.appId + ' != config ' + account.appId;
            return row;
        }
        row.profile = match.name;
        const who = run(bin, ['--profile', match.name, 'whoami']);
        if (who.status !== 0) {
            row.error = (who.stderr || who.stdout || 'whoami failed').trim().split('\n')[0];
            return row;
        }
        try {
            const parsed = JSON.parse(who.stdout);
            row.identity = parsed.identity;
            row.tokenStatus = parsed.tokenStatus;
            row.ok = parsed.available !== false && parsed.tokenStatus === 'ready';
            if (!row.ok)
                row.error = 'identity=' + String(parsed.identity) + ' tokenStatus=' + String(parsed.tokenStatus);
        }
        catch {
            row.error = 'whoami returned non-JSON';
        }
        return row;
    });
}
/**
 * The per-turn instruction block telling the agent which profile to use.
 *
 * Pure and cheap: the channel calls this on every inbound turn via
 * agentPrompt.inboundFormattingHints({ cfg, accountId }). Anything that spawns
 * would be a latency bug here, which is why profile existence is left to
 * healthCheck() and the wrapper's own error message.
 */
function buildIdentityRules(cfg, accountId) {
    try {
        if (!isLarkCliEnabled(cfg, accountId))
            return [];
        const mode = larkCliConfig(cfg, accountId).prompt || 'minimal';
        if (mode === 'off')
            return [];
        const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
        if (!account || !account.accountId)
            return [];
        // No credentials -> nothing to delegate; keep the turn free of noise.
        if (!account.configured)
            return [];
        const profile = resolveProfileName(cfg, account.accountId);
        const wrapper = wrapperPath();
        const allAccounts = (0, accounts_1.getEnabledLarkAccounts)(cfg).map((a) => a.accountId + '=' + resolveProfileName(cfg, a.accountId));
        const others = allAccounts.filter((pair) => !pair.startsWith(account.accountId + '='));
        // minimal (default): ONE line — just the profile this chat must use.
        // Everything else is either enforced by bin/feishu-lark (profile
        // required, global commands refused, output fenced) or discoverable via
        // 'lark-cli --help' / 'profile list' / the feishu-cli skill. This text
        // rides along on EVERY turn, including pure chat, so it stays tiny.
        if (mode === 'minimal') {
            return ['Lark CLI profile for this chat: ' + profile +
                ' (run Lark work as ' + wrapper + ' --profile ' + profile + ' <domain> …).'];
        }
        // compact: adds the other accounts and the never-run list.
        if (mode === 'compact') {
            const compact = [
                'Lark CLI: account=' + account.accountId + ' profile=' + profile + '. Run Lark work as ' +
                    wrapper + ' --profile ' + profile + ' <domain> <cmd> … ; root cmds (whoami/auth/schema/skills/doctor) take no domain.',
            ];
            compact.push((others.length > 0
                ? 'Other accounts: ' + others.join(', ') + ' (explicit request only). '
                : '') + 'Never profile use/add/remove, config bind, or lark-cli update.');
            return compact;
        }
        const rules = [
            'Lark CLI identity for this turn: account=' + account.accountId + ' profile=' + profile + ' brand=' + (account.brand || 'feishu') + '.',
            'Run every Lark business operation (docs/sheets/drive/base/im/task/calendar/wiki/contact) as: ' +
                wrapper + ' --profile ' + profile + ' <domain> <command> ...  — use that absolute path, not lark-cli directly: ' +
                'the wrapper pins this account and fences the output as untrusted data.',
            'CLI shape: root commands take NO domain — whoami, auth login|status|logout, schema <service.resource.method>, ' +
                'skills list|read, doctor. Everything else starts with a domain (docs/im/base/sheets/drive/task/calendar/wiki/contact). ' +
                'So it is "<wrapper> --profile ' + profile + ' whoami", never "auth whoami"; use "<wrapper> --profile ' + profile + ' auth --help" to see auth verbs.',
            'Never run lark-cli profile use / profile add / profile remove / config bind / lark-cli update: ' +
                'those are process-global and change every concurrent session.',
        ];
        if (others.length > 0) {
            rules.push('Other accounts on this gateway: ' + others.join(', ') +
                '. Only use a different --profile when the user explicitly names that account.');
        }
        rules.push('If a command fails for missing user identity, run "' + wrapper + ' --profile ' + profile +
            ' auth login --no-wait --json", send the verification URL to the user, and after they confirm finish with ' +
            '"auth login --device-code <code>".');
        return rules;
    }
    catch (err) {
        // Never let hint construction break an inbound turn.
        log.warn('buildIdentityRules failed (ignored): ' + (err instanceof Error ? err.message : String(err)));
        return [];
    }
}

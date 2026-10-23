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
 * So this module owns exactly one thing: mapping the channel's accountIds onto
 * lark-cli profiles, and telling the agent, once per turn, which profile this
 * turn must use. See bin/feishu-lark for the enforcement half of the contract.
 *
 * Design rules:
 *   - profile name === accountId (no translation table to drift out of sync)
 *   - credentials are read from the live OpenClaw config, never duplicated
 *   - nothing here runs on the hot inbound path except buildIdentityRules(),
 *     which is pure (no spawning) so a slow CLI can never stall a turn
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRAPPER_RELATIVE_PATH = void 0;
exports.wrapperPath = wrapperPath;
exports.profileNameFor = profileNameFor;
exports.isLarkCliEnabled = isLarkCliEnabled;
exports.resolveLarkCliBinary = resolveLarkCliBinary;
exports.listProfiles = listProfiles;
exports.provisionProfiles = provisionProfiles;
exports.healthCheck = healthCheck;
exports.buildIdentityRules = buildIdentityRules;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const accounts_1 = require("../core/accounts.js");
const lark_logger_1 = require("../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('larkcli/profiles');
const SPAWN_TIMEOUT_MS = 20000;
exports.WRAPPER_RELATIVE_PATH = 'bin/feishu-lark';
/** Absolute path to the identity-enforcing wrapper shipped with this plugin. */
function wrapperPath() {
    return (0, node_path_1.join)(__dirname, '..', '..', exports.WRAPPER_RELATIVE_PATH);
}
/**
 * Normalise an accountId into a lark-cli profile name.
 *
 * Kept deliberately boring: whatever the user called the account is what the
 * profile is called. Any translation table would be one more thing that can
 * silently map a write onto the wrong app.
 */
function profileNameFor(accountId) {
    const raw = String(accountId ?? '').trim().toLowerCase();
    if (!raw)
        return 'default';
    const safe = raw.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return safe || 'default';
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
    const home = process.env.HOME || '';
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
 * enabled: true forces it on (useful to make the wrapper's install hint
 * visible), false turns it off, and the default 'auto' follows binary
 * discovery — a host without lark-cli never pays for the injected rules.
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
        env: process.env,
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
function backupCliConfig() {
    const configPath = (0, node_path_1.join)(process.env.HOME || '', '.lark-cli', 'config.json');
    if (!(0, node_fs_1.existsSync)(configPath))
        return undefined;
    const target = configPath + '.bak-lark-2-' + Date.now();
    try {
        (0, node_fs_1.copyFileSync)(configPath, target);
        return target;
    }
    catch (err) {
        log.warn('failed to back up lark-cli config: ' + err.message);
        return undefined;
    }
}
/**
 * Create/repair one lark-cli profile per configured account.
 *
 * Idempotent: an existing profile whose appId already matches is skipped, so
 * this is safe to run from a doctor command or a settings action. A profile
 * whose appId differs is only rewritten when force is set — silently
 * repointing a profile would repoint every session that uses it.
 */
function provisionProfiles(cfg, opts) {
    const options = opts || {};
    const bin = resolveLarkCliBinary(cfg);
    const result = { ok: true, created: [], updated: [], skipped: [], failed: [], backup: undefined };
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
    for (const account of accounts) {
        const name = profileNameFor(account.accountId);
        const match = existing.profiles.find((p) => p.name === name);
        if (match && match.appId === account.appId) {
            result.skipped.push(name);
            continue;
        }
        if (match && match.appId !== account.appId) {
            if (!options.force) {
                result.failed.push({
                    accountId: account.accountId,
                    error: 'profile exists with appId ' + match.appId + ' (config has ' + account.appId + '); re-run with force',
                });
                continue;
            }
            result.backup = result.backup || backupCliConfig();
            const removed = run(bin, ['profile', 'remove', name]);
            if (removed.status !== 0) {
                result.failed.push({
                    accountId: account.accountId,
                    error: 'profile remove failed: ' + (removed.stderr || removed.stdout).trim(),
                });
                continue;
            }
            const reAdded = addProfile(account, name);
            if (reAdded.status === 0)
                result.updated.push(name);
            else
                result.failed.push({ accountId: account.accountId, error: (reAdded.stderr || reAdded.stdout).trim() });
            continue;
        }
        result.backup = result.backup || backupCliConfig();
        const added = addProfile(account, name);
        if (added.status === 0)
            result.created.push(name);
        else
            result.failed.push({ accountId: account.accountId, error: (added.stderr || added.stdout).trim() });
    }
    result.ok = result.failed.length === 0;
    return result;
}
/**
 * Per-account readiness report used by the doctor command.
 *
 * Detects the failure that the config alone cannot: a profile that exists but
 * points at a different appId (e.g. after rotating an app in the Feishu console).
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
        const name = profileNameFor(account.accountId);
        const row = {
            accountId: account.accountId,
            profile: name,
            ok: false,
        };
        if (!existing.ok) {
            row.error = existing.error;
            return row;
        }
        const match = existing.profiles.find((p) => p.name === name);
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
        const who = run(bin, ['--profile', name, 'whoami']);
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
 * agentPrompt.inboundFormattingHints({ cfg, accountId }). Anything that
 * spawns would be a latency bug here, which is why profile existence is left
 * to healthCheck() and the wrapper's own error message.
 */
function buildIdentityRules(cfg, accountId) {
    try {
        if (!isLarkCliEnabled(cfg, accountId))
            return [];
        const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
        if (!account || !account.accountId)
            return [];
        // No credentials -> nothing to delegate; keep the turn free of noise.
        if (!account.configured)
            return [];
        const profile = profileNameFor(account.accountId);
        const wrapper = wrapperPath();
        const allAccounts = (0, accounts_1.getEnabledLarkAccounts)(cfg).map((a) => profileNameFor(a.accountId));
        const others = allAccounts.filter((p) => p !== profile);
        const rules = [
            'Lark CLI identity for this turn: account=' + account.accountId + ' profile=' + profile + ' brand=' + (account.brand || 'feishu') + '.',
            'Run every Lark business operation (docs/sheets/drive/base/im/task/calendar/wiki/contact) as: ' +
                wrapper + ' --profile ' + profile + ' <domain> <command> ...  — use that absolute path, not lark-cli directly: ' +
                'the wrapper pins this account and fences the output as untrusted data.',
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

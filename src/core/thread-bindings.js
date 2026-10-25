"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Feishu thread / conversation bindings.
 *
 * A "binding" links a Feishu conversation (a chat, a topic, or a topic+sender
 * scope — see `conversation-id.js`) to a target session, so replies and
 * subagent output can be routed back to the right place.
 *
 * Core already ships a high-level account-scoped manager
 * (`openclaw/plugin-sdk/thread-bindings-runtime`; V2 since 2026.10.10, with a
 * deprecated synchronous factory on older cores) which, for a given
 * channel+account:
 *   - resolves the idle/max-age policy from config,
 *   - projects its records into `SessionBindingRecord`s, and
 *   - registers / unregisters the session-binding adapter with the host.
 *
 * So this module only supplies the Feishu-specific target-kind mapping and owns
 * the per-account lifecycle. The host then calls `bind()` itself when a
 * subagent/ACP conversation binds.
 *
 * The whole feature is feature-detected: on a core that lacks the manager this
 * module resolves to `null` and the plugin keeps working without bindings.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFeishuThreadBindingsSupported = isFeishuThreadBindingsSupported;
exports.createFeishuThreadBindingManager = createFeishuThreadBindingManager;
exports.getFeishuThreadBindingManager = getFeishuThreadBindingManager;
exports.stopFeishuThreadBindingManager = stopFeishuThreadBindingManager;
exports.resetFeishuThreadBindingsForTests = resetFeishuThreadBindingsForTests;
exports.toStoredTargetKind = toStoredTargetKind;
exports.toSessionBindingTargetKind = toSessionBindingTargetKind;
const account_id_1 = require("openclaw/plugin-sdk/account-id");
const lark_logger_1 = require("./lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('core/thread-bindings');
/**
 * Stable across plugin reloads: core keys its own singleton state by this, so a
 * hot-reloaded plugin reattaches to the same manager instead of leaking a new
 * one (and orphaning live bindings).
 */
const FEISHU_THREAD_BINDINGS_STATE_KEY = Symbol.for('openclaw.feishuThreadBindingManagerState');
/** accountId → manager, for lookup and shutdown. */
const managersByAccountId = new Map();
// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------
let factoryResolved = false;
let managerFactory = null;
/** Resolve (once) the host manager factory; `null` when this core lacks it. */
function loadManagerFactory() {
    if (factoryResolved)
        return managerFactory;
    factoryResolved = true;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('openclaw/plugin-sdk/thread-bindings-runtime');
        // Prefer the V2 manager: worker-backed async reads/writes plus the
        // current-source assertion. The synchronous manager is deprecated
        // (compatibility ends 2026-12-31, removal ships in the first January
        // 2027 stable release).
        //
        // The legacy factory stays only as a fallback for cores that predate
        // 2026.10.10 and ship no V2 surface at all; delete the fallback branch
        // once this plugin's core floor is >= 2026.10.10.
        const v2Factory = mod?.createAccountScopedConversationBindingManagerV2;
        const legacyFactory = mod?.createAccountScopedConversationBindingManager;
        managerFactory = typeof v2Factory === 'function'
            ? v2Factory
            : typeof legacyFactory === 'function'
                ? legacyFactory
                : null;
        if (!managerFactory) {
            log.warn('thread bindings unavailable: this core exposes no account-scoped conversation binding manager');
        }
        else if (typeof v2Factory !== 'function') {
            log.debug('thread bindings: core has no V2 binding manager yet, using the legacy factory');
        }
    }
    catch (err) {
        managerFactory = null;
        log.warn(`thread bindings unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    return managerFactory;
}
/** Whether this core can host Feishu thread bindings. */
function isFeishuThreadBindingsSupported() {
    return loadManagerFactory() !== null;
}
// ---------------------------------------------------------------------------
// Target-kind mapping
// ---------------------------------------------------------------------------
/**
 * Feishu stores the non-subagent kind as `acp` (the ACP conversation binding),
 * while core speaks `subagent | session`. These two map between the two.
 */
function toStoredTargetKind(kind) {
    return kind === 'subagent' ? 'subagent' : 'acp';
}
function toSessionBindingTargetKind(kind) {
    return kind === 'subagent' ? 'subagent' : 'session';
}
// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
/**
 * Create (or reuse) the binding manager for one account.
 *
 * Returns `null` when the host lacks the API — callers must treat that as
 * "bindings unavailable" and carry on.
 */
function createFeishuThreadBindingManager(params) {
    const factory = loadManagerFactory();
    if (!factory)
        return null;
    const accountId = (0, account_id_1.normalizeAccountId)(params.accountId);
    const existing = managersByAccountId.get(accountId);
    if (existing)
        return existing;
    const manager = factory({
        accountId,
        cfg: params.cfg,
        channel: 'feishu',
        stateKey: FEISHU_THREAD_BINDINGS_STATE_KEY,
        toStoredTargetKind,
        toSessionBindingTargetKind,
    });
    managersByAccountId.set(accountId, manager);
    return manager;
}
/** The live manager for an account, or `null` when none is running. */
function getFeishuThreadBindingManager(accountId) {
    return managersByAccountId.get((0, account_id_1.normalizeAccountId)(accountId)) ?? null;
}
/** Stop one account's manager (idempotent). */
function stopFeishuThreadBindingManager(accountId) {
    const normalized = (0, account_id_1.normalizeAccountId)(accountId);
    const manager = managersByAccountId.get(normalized);
    if (!manager)
        return;
    managersByAccountId.delete(normalized);
    try {
        manager.stop();
    }
    catch (err) {
        log.warn(`failed to stop thread binding manager for ${normalized}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Test-only: stop and forget every account's manager.
 *
 * Note: this does NOT clear the bindings themselves — core keeps them durably
 * (they survive a manager stop by design), so tests should use distinct
 * conversation ids / session keys rather than relying on this to isolate state.
 */
function resetFeishuThreadBindingsForTests() {
    for (const accountId of [...managersByAccountId.keys()]) {
        stopFeishuThreadBindingManager(accountId);
    }
    managersByAccountId.clear();
}

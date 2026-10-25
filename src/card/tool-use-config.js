"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Resolution logic for Feishu tool-use display.
 *
 * The source of truth is OpenClaw's effective verbose state:
 * inline `/verbose` override > session store override > config default.
 * Feishu channel config only retains UI-level detail (`showFullPaths`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveToolUseDisplayConfig = resolveToolUseDisplayConfig;
const agent_runtime_1 = require("openclaw/plugin-sdk/agent-runtime");
const session_store_runtime_1 = require("openclaw/plugin-sdk/session-store-runtime");
async function resolveToolUseDisplayConfig(params) {
    const mode = await resolveEffectiveVerboseMode(params);
    // 默认开启工具动态展示：只有显式关闭（verbose off / toolUseDisplay.enabled=false）才隐藏。
    // mode === undefined 表示 verbose 从未配置，视为开启（卡片内展示，不产生独立文本消息）。
    const feishuEnabled = params.feishuCfg?.toolUseDisplay?.enabled;
    const showToolUse = feishuEnabled === false ? false : mode !== 'off';
    return {
        mode: mode ?? 'off',
        showToolUse,
        showToolResultDetails: mode === 'full',
        showFullPaths: params.feishuCfg?.toolUseDisplay?.showFullPaths === true,
    };
}
async function resolveEffectiveVerboseMode(params) {
    // 内联覆盖无需读会话库：先短路，省掉一次（worker 支撑的）会话查询。
    const inline = extractInlineVerboseMode(params.body);
    if (inline)
        return inline;
    return ((await resolveSessionVerboseMode(params.cfg, params.sessionKey, params.agentId)) ??
        normalizeToolUseMode(params.cfg.agents?.defaults?.verboseDefault));
}
async function resolveSessionVerboseMode(cfg, sessionKey, agentId) {
    try {
        // 只走异步读（getSessionEntryAsync）。同步读取已废弃：2026-12-31
        // 结束兼容期，2027 年 1 月首个 stable 版本移除。老 core 上没有异步
        // 读时，直接视为「无会话级覆盖」，回落到配置默认值，不影响主流程。
        const readEntry = session_store_runtime_1.getSessionEntryAsync;
        if (typeof readEntry !== 'function')
            return undefined;
        const cfgWithSession = cfg;
        const sessionStorePath = cfgWithSession.session?.store ?? cfgWithSession.sessions?.store;
        const storePath = (0, session_store_runtime_1.resolveStorePath)(sessionStorePath, { agentId });
        const candidateKeys = resolveCandidateSessionKeys(cfg, sessionKey);
        for (const candidateKey of candidateKeys) {
            const existing = await readEntry({
                agentId,
                storePath,
                sessionKey: candidateKey,
                readConsistency: 'latest',
            });
            const mode = normalizeToolUseMode(existing?.verboseLevel);
            if (mode)
                return mode;
            if (existing)
                return undefined;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function resolveCandidateSessionKeys(cfg, sessionKey) {
    const key = sessionKey.trim().toLowerCase();
    const defaultAgentId = (0, agent_runtime_1.resolveDefaultAgentId)(cfg);
    const fallbackKey = key.replace(/^(agent):[^:]+:/, `$1:${defaultAgentId}:`);
    return fallbackKey !== key ? [key, fallbackKey] : [key];
}
function extractInlineVerboseMode(body) {
    if (!body)
        return undefined;
    const matches = body.matchAll(/(?:^|\s)\/(?:verbose|v)(?::|\s+)(on|off|full)\b/gi);
    let last;
    for (const match of matches) {
        last = normalizeToolUseMode(match[1]);
    }
    return last;
}
function normalizeToolUseMode(value) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'on' || normalized === 'full') {
        return normalized;
    }
    return undefined;
}

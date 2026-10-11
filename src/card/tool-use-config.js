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
// OpenClaw >=2026.10: config-runtime retired; session-store helpers now live in session-store-runtime.
const session_store_runtime_1 = require("openclaw/plugin-sdk/session-store-runtime");
function resolveToolUseDisplayConfig(params) {
    const mode = resolveEffectiveVerboseMode(params);
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
function resolveEffectiveVerboseMode(params) {
    return (extractInlineVerboseMode(params.body) ??
        resolveSessionVerboseMode(params.cfg, params.sessionKey, params.agentId) ??
        normalizeToolUseMode(params.cfg.agents?.defaults?.verboseDefault));
}
function resolveSessionVerboseMode(cfg, sessionKey, agentId) {
    try {
        const candidateKeys = resolveCandidateSessionKeys(cfg, sessionKey);
        for (const candidateKey of candidateKeys) {
            const existing = (0, session_store_runtime_1.getSessionEntry)({ agentId, sessionKey: candidateKey });
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

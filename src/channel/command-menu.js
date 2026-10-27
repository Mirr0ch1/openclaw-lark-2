"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw core command argument menus → Feishu interactive buttons.
 *
 * Core owns the command *model*: `commands-registry` declares each command's
 * arguments and their choices (`/verbose` → on|off|full, `/think` → the
 * thinking levels the current model supports, …) and exposes the resolution
 * helpers through `openclaw/plugin-sdk/native-command-registry`.
 *
 * The Telegram channel renders those menus itself: it intercepts the command
 * before core handles it, resolves the menu and sends an inline keyboard whose
 * `callback_data` is the full command text (`/verbose on`). Feishu has no
 * native command registration, so this module does the same job for the
 * Feishu text path: it resolves the menu and produces one button per choice.
 *
 * Every button carries `{ action: "inject_prompt", prompt }`, so clicking it
 * dispatches the chosen command text as a synthetic user message and the
 * normal command pipeline takes over — no Feishu-specific command state.
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFeishuCommandMenu = void 0;
const native_command_registry_1 = require("openclaw/plugin-sdk/command-auth-native");
const session_store_runtime_1 = require("openclaw/plugin-sdk/session-store-runtime");
/** Matches a leading slash command and captures the rest as its arguments. */
const COMMAND_TEXT_RE = /^\/([A-Za-z0-9_.-]+)(?:\s+([\s\S]*))?$/;
/**
 * Parse the command name and its arguments out of an inbound text message.
 *
 * @returns {{ name: string, argsText: string } | undefined}
 */
function parseCommandText(text) {
    if (typeof text !== 'string')
        return undefined;
    const trimmed = text.trim();
    if (!trimmed.startsWith('/'))
        return undefined;
    const match = COMMAND_TEXT_RE.exec(trimmed);
    if (!match)
        return undefined;
    return { name: match[1], argsText: (match[2] ?? '').trim() };
}
/**
 * Resolve the provider/model the session is currently running with.
 *
 * Command menus whose choices depend on the model (`/think`) list the levels
 * that model supports, so the session's override has to win over the
 * configured default.
 */
async function resolveSessionModelContext(params) {
    const { cfg, agentId, sessionKey } = params;
    const context = {};
    if (!cfg || !sessionKey)
        return context;
    try {
        const readEntry = session_store_runtime_1.getSessionEntryAsync;
        if (typeof readEntry !== 'function')
            return context;
        const storePath = (0, session_store_runtime_1.resolveStorePath)(cfg.session?.store ?? cfg.sessions?.store, { agentId });
        const entry = await readEntry({
            agentId,
            storePath,
            sessionKey,
            readConsistency: 'latest',
        });
        if (!entry)
            return context;
        const provider = entry.providerOverride ?? entry.modelProvider;
        const model = entry.modelOverride ?? entry.model;
        if (typeof provider === 'string' && provider.trim())
            context.provider = provider.trim();
        if (typeof model === 'string' && model.trim())
            context.model = model.trim();
        return context;
    }
    catch {
        return context;
    }
}
/**
 * Resolve the argument menu for an inbound command text.
 *
 * @param {{ cfg: unknown, agentId?: string, sessionKey?: string, text: string }} params
 * @returns {Promise<{ title: string, buttons: Array<{ label: string, prompt: string }> } | undefined>}
 * The menu, or undefined when the command has no argument menu (the caller
 * then lets core handle the command as usual).
 */
async function resolveFeishuCommandMenu(params) {
    const parsed = parseCommandText(params?.text);
    if (!parsed)
        return undefined;
    // Resolve the text alias the same way core's command detection does, so
    // short forms (`/v`) reach the same command definition.
    const alias = (0, native_command_registry_1.maybeResolveTextAlias)(params?.text, params?.cfg);
    const commandName = alias ? alias.replace(/^\//, '') : parsed.name;
    const command = (0, native_command_registry_1.findCommandByNativeName)(commandName, 'feishu', { includeBundledChannelFallback: false });
    if (!command)
        return undefined;
    // `parseCommandArgs` returns undefined for an empty argument string — that
    // is the "bare command" case, which is exactly when the menu is offered.
    const args = (0, native_command_registry_1.parseCommandArgs)(command, parsed.argsText);
    if (args === undefined && parsed.argsText)
        return undefined;
    if (!(0, native_command_registry_1.canResolveCommandArgMenu)({ command, args }))
        return undefined;
    const agentId = params?.agentId ?? 'main';
    const sessionKey = params?.sessionKey;
    const modelContext = await resolveSessionModelContext({ cfg: params?.cfg, agentId, sessionKey });
    const menu = (0, native_command_registry_1.resolveCommandArgMenu)({
        command,
        args,
        cfg: params?.cfg,
        provider: modelContext.provider,
        model: modelContext.model,
        ...sessionKey ? { session: { agentId, sessionKey } } : {},
    });
    if (!menu || !Array.isArray(menu.choices) || menu.choices.length === 0)
        return undefined;
    const title = (0, native_command_registry_1.formatCommandArgMenuTitle)({ command, menu });
    const buttons = [];
    for (const choice of menu.choices) {
        const label = typeof choice?.label === 'string' ? choice.label.trim() : '';
        if (!label)
            continue;
        buttons.push({
            label,
            prompt: (0, native_command_registry_1.buildCommandTextFromArgs)(command, {
                values: { [menu.arg.name]: choice.value },
            }),
        });
    }
    if (buttons.length === 0)
        return undefined;
    return { title, buttons };
}
exports.resolveFeishuCommandMenu = resolveFeishuCommandMenu;

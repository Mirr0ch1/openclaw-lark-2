"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Model picker → Feishu buttons.
 *
 * OpenClaw core drives the model picker and asks the channel for the buttons
 * through the `ChannelCommandAdapter` hooks:
 *
 *   - `buildModelBrowseChannelData` — the "Browse providers" button shown with
 *     the bare `/model` reply.
 *   - `buildModelsMenuChannelData` / `buildModelsProviderChannelData` — the
 *     provider list shown by `/models`.
 *   - `buildModelsListChannelData` — the model list for one provider.
 *   - `buildModelsAddProviderChannelData` — the provider list for `/models add`.
 *
 * The Telegram channel answers these with an inline keyboard whose
 * `callback_data` drives a stateful in-place picker. Feishu has no native
 * command registration, so each button instead injects the equivalent command
 * text as a user message:
 *
 *   - provider → `/models <provider>`
 *   - model    → `/model <provider>/<model> -s` (session scope, the same scope
 *     the Telegram picker applies)
 *   - back     → `/models providers`
 *
 * Core then runs the ordinary command pipeline, so the selection is applied by
 * core itself instead of by plugin-local state.
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFeishuModelBrowseChannelData = void 0;
exports.buildFeishuModelsAddProviderChannelData = void 0;
exports.buildFeishuModelsListChannelData = void 0;
exports.buildFeishuModelsMenuChannelData = void 0;
exports.buildFeishuModelsProviderChannelData = void 0;
/**
 * Wrap plugin-native buttons into the channelData shape core expects.
 *
 * `buttonsPerRow` controls the card layout: model labels are long, so the
 * model picker puts one button per row while short command labels share a
 * row.
 */
function withFeishuButtons(buttons, buttonsPerRow) {
    return { feishu: { buttons, ...buttonsPerRow ? { buttonsPerRow } : {} } };
}
/** The provider list, shared by the menu and provider hooks. */
function buildProviderButtons(params) {
    const providers = Array.isArray(params?.providers) ? params.providers : [];
    const buttons = [];
    for (const provider of providers) {
        const id = typeof provider?.id === 'string' ? provider.id.trim() : '';
        if (!id)
            continue;
        const count = typeof provider?.count === 'number' ? provider.count : undefined;
        buttons.push({
            label: count === undefined ? id : `${id} (${count})`,
            prompt: `/models ${id}`,
        });
    }
    return buttons;
}
/**
 * The provider list shown by `/models` (and by the bare `/model` picker).
 */
function buildFeishuModelsMenuChannelData(params) {
    const buttons = buildProviderButtons(params);
    return buttons.length > 0 ? withFeishuButtons(buttons) : null;
}
exports.buildFeishuModelsMenuChannelData = buildFeishuModelsMenuChannelData;
/** Alias of {@link buildFeishuModelsMenuChannelData} used by core's provider hook. */
function buildFeishuModelsProviderChannelData(params) {
    return buildFeishuModelsMenuChannelData(params);
}
exports.buildFeishuModelsProviderChannelData = buildFeishuModelsProviderChannelData;
/**
 * The provider list shown by `/models add <provider>`.
 */
function buildFeishuModelsAddProviderChannelData(params) {
    const providers = Array.isArray(params?.providers) ? params.providers : [];
    const buttons = [];
    for (const provider of providers) {
        const id = typeof provider?.id === 'string' ? provider.id.trim() : '';
        if (!id)
            continue;
        buttons.push({ label: id, prompt: `/models add ${id}` });
    }
    return buttons.length > 0 ? withFeishuButtons(buttons) : null;
}
exports.buildFeishuModelsAddProviderChannelData = buildFeishuModelsAddProviderChannelData;
/**
 * The model list for one provider, with pagination and a back button.
 */
function buildFeishuModelsListChannelData(params) {
    const provider = typeof params?.provider === 'string' ? params.provider.trim() : '';
    const models = Array.isArray(params?.models) ? params.models : [];
    if (!provider || models.length === 0) {
        return withFeishuButtons([{ label: '« Back', prompt: '/models providers' }], 1);
    }
    const pageSize = typeof params?.pageSize === 'number' && params.pageSize > 0 ? params.pageSize : 8;
    const totalPages = Math.max(1, typeof params?.totalPages === 'number' ? params.totalPages : 1);
    const currentPage = Math.min(Math.max(1, typeof params?.currentPage === 'number' ? params.currentPage : 1), totalPages);
    const currentModel = typeof params?.currentModel === 'string' ? params.currentModel.trim() : '';
    const modelNames = params?.modelNames instanceof Map ? params.modelNames : undefined;
    const startIndex = (currentPage - 1) * pageSize;
    const pageModels = models.slice(startIndex, startIndex + pageSize);
    const buttons = [];
    for (const model of pageModels) {
        const modelId = typeof model === 'string' ? model.trim() : '';
        if (!modelId)
            continue;
        const qualified = modelId.includes('/') ? modelId : `${provider}/${modelId}`;
        const displayLabel = modelNames?.get(qualified) ?? modelId;
        const isCurrent = currentModel.length > 0 && currentModel === qualified;
        buttons.push({
            label: isCurrent ? `${displayLabel} ✓` : displayLabel,
            prompt: `/model ${qualified} -s`,
        });
    }
    if (totalPages > 1) {
        if (currentPage > 1) {
            buttons.push({ label: '◀ Prev', prompt: `/models ${provider} ${currentPage - 1}` });
        }
        if (currentPage < totalPages) {
            buttons.push({ label: 'Next ▶', prompt: `/models ${provider} ${currentPage + 1}` });
        }
    }
    buttons.push({ label: '« Back', prompt: '/models providers' });
    return withFeishuButtons(buttons, 1);
}
exports.buildFeishuModelsListChannelData = buildFeishuModelsListChannelData;
/**
 * The "Browse providers" button shown with the bare `/model` reply.
 */
function buildFeishuModelBrowseChannelData() {
    return withFeishuButtons([{ label: 'Browse providers', prompt: '/models providers' }], 1);
}
exports.buildFeishuModelBrowseChannelData = buildFeishuModelBrowseChannelData;

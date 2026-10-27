/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Model picker → Feishu buttons.
 *
 * These answer core's `ChannelCommandAdapter` hooks. Each button injects the
 * equivalent command text so core performs the selection itself.
 */
import type { ReplyPayload } from 'openclaw/plugin-sdk';
import type { FeishuInjectButton } from '../card/presentation-card';
/** The `channelData` shape core carries the Feishu buttons in. */
export type FeishuModelMenuChannelData = ReplyPayload['channelData'] & {
    feishu: {
        buttons: FeishuInjectButton[];
        buttonsPerRow?: number;
    };
};
/** The provider list shown by `/models` and by the bare `/model` picker. */
export declare function buildFeishuModelsMenuChannelData(params: {
    providers: Array<{ id: string; count: number }>;
}): FeishuModelMenuChannelData | null;
/** Alias of {@link buildFeishuModelsMenuChannelData} used by core's provider hook. */
export declare function buildFeishuModelsProviderChannelData(params: {
    providers: Array<{ id: string; count: number }>;
}): FeishuModelMenuChannelData | null;
/** The provider list shown by `/models add <provider>`. */
export declare function buildFeishuModelsAddProviderChannelData(params: {
    providers: Array<{ id: string }>;
}): FeishuModelMenuChannelData | null;
/** The model list for one provider, with pagination and a back button. */
export declare function buildFeishuModelsListChannelData(params: {
    provider: string;
    models: readonly string[];
    currentModel?: string;
    currentPage: number;
    totalPages: number;
    pageSize?: number;
    modelNames?: ReadonlyMap<string, string>;
}): FeishuModelMenuChannelData | null;
/** The "Browse providers" button shown with the bare `/model` reply. */
export declare function buildFeishuModelBrowseChannelData(): FeishuModelMenuChannelData;

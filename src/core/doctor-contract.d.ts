/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Plugin doctor contract: repairs legacy `channels.feishu` config.
 */
import type { ChannelDoctorConfigMutation, ChannelDoctorLegacyConfigRule } from 'openclaw/plugin-sdk/channel-contract';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/config-contracts';
/** Rules the host reports as "legacy config present" before `--fix` runs. */
export declare const legacyConfigRules: ChannelDoctorLegacyConfigRule[];
/** Apply all Feishu config repairs. */
export declare function normalizeCompatibilityConfig(params: {
    cfg: OpenClawConfig;
}): ChannelDoctorConfigMutation;

/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw core command argument menus → Feishu interactive buttons.
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import type { FeishuInjectButton } from '../card/presentation-card';
/** A resolved command argument menu. */
export interface FeishuCommandMenu {
    /** Title shown above the buttons. */
    title: string;
    /** One button per choice; each injects its command text. */
    buttons: FeishuInjectButton[];
}
/**
 * Resolve the argument menu for an inbound command text.
 *
 * Returns undefined when the command has no argument menu (the caller then
 * lets core handle the command as usual).
 */
export declare function resolveFeishuCommandMenu(params: {
    cfg?: ClawdbotConfig;
    agentId?: string;
    sessionKey?: string;
    text: string;
}): Promise<FeishuCommandMenu | undefined>;

/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Portable OpenClaw `MessagePresentation` → Feishu interactive card.
 */
import type { ChannelPresentationCapabilities } from 'openclaw/plugin-sdk';
/** A button that injects its command text as a synthetic user message. */
export interface FeishuInjectButton {
    label: string;
    prompt: string;
}
/** Plugin-native button list carried in `channelData.feishu`. */
export interface FeishuButtonChannelData {
    buttons: FeishuInjectButton[];
    /** How many buttons share one card row. Defaults to the capability limit. */
    buttonsPerRow?: number;
}
/**
 * Channel capabilities advertised to OpenClaw core for Feishu.
 *
 * Feishu renders markdown tables inside card `markdown` elements and has no
 * native chart element, so charts are downgraded to text by core.
 */
export declare const FEISHU_PRESENTATION_CAPABILITIES: ChannelPresentationCapabilities;
/**
 * Resolve the transport behaviour of a portable button.
 *
 * `command` actions become an inject-prompt button, `url` actions become an
 * open-url button, and every other action type is opaque (the payload was
 * addressed to another channel's transport).
 */
export declare function resolvePresentationButtonAction(button: unknown): {
    kind: 'inject' | 'url' | 'opaque';
    prompt?: string;
    url?: string;
    value?: string;
};
/**
 * Build a Feishu interactive card from a portable presentation.
 *
 * Returns undefined when the presentation carries nothing renderable.
 */
export declare function buildPresentationCard(presentation: unknown): Record<string, unknown> | undefined;
/**
 * Build a Feishu card that carries a row of buttons.
 *
 * Used by the command argument menu and the model picker.
 */
export declare function buildFeishuButtonsCard(params: {
    title?: string;
    text?: string;
    buttonsPerRow?: number;
    buttons?: FeishuInjectButton[];
}): Record<string, unknown> | undefined;

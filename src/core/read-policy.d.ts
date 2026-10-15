/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Read authorization for Feishu tools.
 *
 * Ported from @openclaw/feishu `src/read-policy.ts`; the read context is
 * reconstructed from the active LarkTicket instead of the host tool context.
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import type { LarkAccount } from './types';
export interface FeishuReadContext {
    accountId?: string;
    currentChannelId?: string;
    requesterAccountId?: string;
    requesterSenderId?: string;
    currentChatType?: 'p2p' | 'group';
    directOperator: boolean;
}
/** Reconstruct the read context from the active LarkTicket (with overrides). */
export declare function resolveFeishuReadContext(override?: Partial<FeishuReadContext>): FeishuReadContext;
/** Normalise a Feishu chat type to `p2p` | `group` | undefined. */
export declare function normalizeFeishuChatType(raw?: unknown): 'p2p' | 'group' | undefined;
/** Resolve the chat type from a Feishu chat-info payload. */
export declare function resolveFeishuChatType(chat?: {
    chat_mode?: unknown;
    chat_type?: unknown;
}): 'p2p' | 'group' | undefined;
export declare function isCurrentFeishuChat(params: {
    account: LarkAccount;
    chatId: string;
    ctx?: FeishuReadContext;
}): boolean;
export declare function isFeishuGroupReadAllowed(cfg: ClawdbotConfig, account: LarkAccount, chatId: string, current: boolean): boolean;
export declare function isFeishuGroupReadEnabled(cfg: ClawdbotConfig, account: LarkAccount, chatId: string): boolean;
export declare function canEnumerateAllFeishuPeers(account: LarkAccount): boolean;
export interface FeishuChatReadParams {
    cfg: ClawdbotConfig;
    account: LarkAccount;
    ctx: FeishuReadContext;
    chatId: string;
    chatType?: 'p2p' | 'group';
}
export type FeishuChatReadPreliminaryDecision = 'allow' | 'deny' | 'needs-metadata';
export declare function resolveFeishuChatReadPreliminaryAuthorization(params: FeishuChatReadParams): {
    chatId: string;
    decision: FeishuChatReadPreliminaryDecision;
};
export declare function assertFeishuChatReadAllowed(params: FeishuChatReadParams): string;
export declare function readFeishuChatInfoWithAuthorization<T extends {
    chat_mode?: unknown;
    chat_type?: unknown;
}>(params: {
    cfg: ClawdbotConfig;
    account: LarkAccount;
    ctx: FeishuReadContext;
    preliminary: ReturnType<typeof resolveFeishuChatReadPreliminaryAuthorization>;
}, readChatInfo: (chatId: string) => Promise<T>): Promise<T>;
export type FeishuChatMemberReadAuthorization = {
    kind: 'group';
    chatId: string;
} | {
    kind: 'direct';
    chatId: string;
    memberId: string;
    memberIdType: 'open_id' | 'user_id';
};
export declare function authorizeFeishuChatMemberRead(params: FeishuChatReadParams & {
    memberId?: string;
    memberIdType?: 'open_id' | 'user_id' | 'union_id';
}): FeishuChatMemberReadAuthorization;

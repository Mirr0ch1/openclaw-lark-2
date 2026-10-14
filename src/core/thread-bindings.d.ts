import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
/** Feishu's stored target kind: `acp` where core speaks `session`. */
export type FeishuStoredTargetKind = 'subagent' | 'acp';
/** A feishu thread binding record as returned by the core manager. */
export interface FeishuThreadBindingRecord {
    accountId: string;
    conversationId: string;
    targetKind: FeishuStoredTargetKind;
    targetSessionKey: string;
    agentId?: string;
    label?: string;
    boundBy?: string;
    boundAt: number;
    lastActivityAt: number;
}
/** Account-scoped binding manager (core-provided). */
export interface FeishuThreadBindingManager {
    accountId: string;
    getByConversationId: (conversationId: string) => FeishuThreadBindingRecord | undefined;
    listBySessionKey: (targetSessionKey: string) => FeishuThreadBindingRecord[];
    bindConversation: (input: {
        conversationId: string;
        targetKind: 'subagent' | 'session';
        targetSessionKey: string;
        metadata?: Record<string, unknown>;
    }) => FeishuThreadBindingRecord | null;
    touchConversation: (conversationId: string, at?: number) => FeishuThreadBindingRecord | null;
    unbindConversation: (conversationId: string) => FeishuThreadBindingRecord | null;
    unbindBySessionKey: (targetSessionKey: string) => FeishuThreadBindingRecord[];
    stop: () => void;
}
/** Whether this core can host Feishu thread bindings. */
export declare function isFeishuThreadBindingsSupported(): boolean;
/**
 * Create (or reuse) the binding manager for one account.
 * Returns `null` when the host lacks the API.
 */
export declare function createFeishuThreadBindingManager(params: {
    cfg: ClawdbotConfig;
    accountId?: string;
}): FeishuThreadBindingManager | null;
/** The live manager for an account, or `null` when none is running. */
export declare function getFeishuThreadBindingManager(accountId?: string): FeishuThreadBindingManager | null;
/** Stop one account's manager (idempotent). */
export declare function stopFeishuThreadBindingManager(accountId?: string): void;
/**
 * Test-only: stop and forget every account's manager.
 * Does NOT clear bindings (core keeps them durably).
 */
export declare function resetFeishuThreadBindingsForTests(): void;
/** Map a core target kind to Feishu's stored kind. */
export declare function toStoredTargetKind(kind: 'subagent' | 'session'): FeishuStoredTargetKind;
/** Map Feishu's stored kind back to a core target kind. */
export declare function toSessionBindingTargetKind(kind: FeishuStoredTargetKind): 'subagent' | 'session';

/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Typing reaction on Feishu document comment threads.
 * Ported from @openclaw/feishu `src/comment-reaction.ts`.
 */
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
/** Add or remove the `Typing` reaction on a comment reply. */
export declare function requestCommentTypingReaction(params: {
    cfg: ClawdbotConfig;
    fileToken: string;
    fileType: string;
    replyId: string;
    action: 'add' | 'delete';
    accountId?: string;
}): Promise<boolean>;
/** Remove any tracked typing reaction for a comment target. */
export declare function cleanupAmbientCommentTypingReaction(params: {
    cfg: ClawdbotConfig;
    fileToken?: string;
    fileType?: string;
    replyId?: string;
    accountId?: string;
}): Promise<boolean>;
/** Lifecycle for one comment event: `start()` adds, `cleanup()` removes. */
export declare function createCommentTypingReactionLifecycle(params: {
    cfg: ClawdbotConfig;
    fileToken: string;
    fileType: string;
    replyId?: string;
    accountId?: string;
}): {
    start: () => Promise<void>;
    cleanup: () => Promise<void>;
};
/** Test-only: drop all tracked typing-reaction state. */
export declare function _resetCommentTypingReactionState(): void;

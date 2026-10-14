/** Parent conversation candidates for a raw Feishu conversation id (narrowest → broadest). */
export declare function resolveFeishuParentConversationCandidates(rawId: string): string[];
/** Canonical Feishu session conversation for a raw id (core `messaging.resolveSessionConversation`). */
export declare function resolveFeishuSessionConversation(params: {
    kind: 'group' | 'channel';
    rawId: string;
}): {
    id: string;
    baseConversationId: string;
    parentConversationCandidates: string[];
} | null;

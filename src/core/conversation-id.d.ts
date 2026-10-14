/** Group session scope — how many sessions a Feishu group can host. */
export type FeishuGroupSessionScope = 'group' | 'group_sender' | 'group_topic' | 'group_topic_sender';
/** Resolve the effective group session scope (config wins over legacy topicSessionMode). */
export declare function resolveConfiguredFeishuGroupSessionScope(params: {
    groupConfig?: {
        groupSessionScope?: FeishuGroupSessionScope;
        topicSessionMode?: 'enabled' | 'disabled';
    };
    feishuCfg?: {
        groupSessionScope?: FeishuGroupSessionScope;
        topicSessionMode?: 'enabled' | 'disabled';
    };
}): FeishuGroupSessionScope;
/** Build a conversation id from its parts. */
export declare function buildFeishuConversationId(params: {
    chatId: string;
    scope: FeishuGroupSessionScope;
    senderOpenId?: string;
    topicId?: string;
}): string;
/** Normalise an arbitrary target to a bare Feishu id, if it is one. */
export declare function parseFeishuTargetId(raw: unknown): string | undefined;
/** Extract the open id when the conversation id names a DM. */
export declare function parseFeishuDirectConversationId(raw: unknown): string | undefined;
/** Parse a conversation id back into its parts. */
export declare function parseFeishuConversationId(params: {
    conversationId: string;
    parentConversationId?: string;
}): {
    canonicalConversationId: string;
    chatId: string;
    topicId?: string;
    senderOpenId?: string;
    scope: FeishuGroupSessionScope;
} | null;
/** Parent conversation candidates for per-conversation model overrides. */
export declare function buildFeishuModelOverrideParentCandidates(parentConversationId?: string | null): string[];

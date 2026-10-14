import type { ChannelOutboundSessionRouteParams, buildChannelOutboundSessionRoute } from 'openclaw/plugin-sdk/channel-core';
/** Whether the host exposes the channel-core helpers this route needs. */
export declare function isFeishuOutboundSessionRouteSupported(): boolean;
/**
 * Resolve the outbound session route for a Feishu target.
 * Returns `null` when the target is empty or the host lacks the helpers.
 */
export declare function resolveFeishuOutboundSessionRoute(params: ChannelOutboundSessionRouteParams): ReturnType<typeof buildChannelOutboundSessionRoute> | null;

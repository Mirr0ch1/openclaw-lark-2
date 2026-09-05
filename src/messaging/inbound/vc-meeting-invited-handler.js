"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * VC meeting invited event handler for the Lark/Feishu channel plugin.
 *
 * Handles `vc.bot.meeting_invited_v1` by converting the event into a
 * synthetic natural-language inbound and dispatching it through the
 * standard OpenClaw agent pipeline.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFeishuVcMeetingInvited = handleFeishuVcMeetingInvited;
const crypto = __importStar(require("node:crypto"));
const synthetic_target_1 = require("../../core/synthetic-target.js");
const accounts_1 = require("../../core/accounts.js");
const lark_logger_1 = require("../../core/lark-logger.js");
const dispatch_1 = require("./dispatch.js");
const gate_effects_1 = require("./gate-effects.js");
const gate_1 = require("./gate.js");
const policy_1 = require("./policy.js");
const vc_sender_1 = require("./vc-sender.js");
const logger = (0, lark_logger_1.larkLogger)('inbound/vc-meeting-invited-handler');
function buildSyntheticEvent(event) {
    const meetingNo = event.meeting?.meeting_no?.trim() ?? '';
    // Both meeting_no and inviter identity are required for this event.
    if (!meetingNo) {
        return null;
    }
    const sender = (0, vc_sender_1.resolveVcSender)(event);
    if (!sender.senderId) {
        return null;
    }
    return {
        eventType: 'vc.bot.meeting_invited_v1',
        source: 'feishu-vc-event',
        eventId: event.event_id?.trim() || undefined,
        meetingId: event.meeting?.id?.trim() || undefined,
        meetingNo,
        topic: event.meeting?.topic?.trim() || undefined,
        senderId: sender.senderId,
        senderOpenId: sender.senderOpenId,
        senderUserId: sender.senderUserId,
        senderUnionId: sender.senderUnionId,
        senderName: sender.senderName,
        inviteTime: event.invite_time?.trim() || undefined,
        callId: event.call_id?.trim() || undefined,
    };
}
function buildSyntheticContext(event) {
    // Keep the synthetic inbound prompt in English for now: it is an
    // agent-facing intent string rather than user-visible copy, and the final
    // reply language is still governed by the agent/session prompt stack.
    // If we later need locale-aware synthetic prompts, this is the single place
    // to introduce a template or config-based language switch.
    // Only append the call_id instruction when the invite event actually
    // carries one. Forcing call_id="" into the prompt would assume every
    // downstream join tool / CLI shortcut already recognises the parameter —
    // during rollout that assumption can break auto-join. When absent we keep
    // the legacy prompt shape so behavior degrades to the pre-call_id path.
    const callIdInstruction = event.callId
        ? ` When invoking the join tool, pass call_id="${event.callId}".`
        : '';
    const syntheticText = `Use the available tool to join the meeting with meeting number ${event.meetingNo} immediately. Do not ask for confirmation.${callIdInstruction}`;
    const syntheticMessageId = event.eventId
        ? `vc-invited:event:${event.eventId}`
        : `vc-invited:${event.meetingNo}:${event.inviteTime ?? crypto.randomUUID()}`;
    // VC-invited events have no real chat/thread — they are service-to-service
    // triggers. Using the inviter's open_id as chatId would cause downstream
    // senders (reply / card / media) to fire off unsolicited DMs to the inviter
    // whenever the agent produced any output. Use a synthetic sentinel instead
    // and let IM-facing deliverers short-circuit on it (see SYNTHETIC_VC_CHAT_ID).
    return {
        chatId: synthetic_target_1.SYNTHETIC_VC_CHAT_ID,
        messageId: syntheticMessageId,
        senderId: event.senderId,
        senderName: event.senderName,
        chatType: synthetic_target_1.SYNTHETIC_VC_CHAT_TYPE,
        content: syntheticText,
        contentType: 'text',
        resources: [],
        mentions: [],
        mentionAll: false,
        rawMessage: {
            message_id: syntheticMessageId,
            chat_id: synthetic_target_1.SYNTHETIC_VC_CHAT_ID,
            chat_type: synthetic_target_1.SYNTHETIC_VC_CHAT_TYPE,
            message_type: 'text',
            content: JSON.stringify({ text: syntheticText }),
            create_time: event.inviteTime ?? String(Date.now()),
        },
        rawSender: {
            sender_id: {
                ...(event.senderOpenId ? { open_id: event.senderOpenId } : {}),
                ...(event.senderUserId ? { user_id: event.senderUserId } : {}),
                ...(event.senderUnionId ? { union_id: event.senderUnionId } : {}),
            },
            sender_type: 'user',
        },
    };
}
function matchesAnySenderId(params) {
    const candidates = [...new Set(params.senderIds.map((id) => id?.trim()).filter(Boolean))];
    return candidates.some((candidate) => (0, policy_1.resolveFeishuAllowlistMatch)({
        allowFrom: params.allowFrom,
        senderId: candidate,
    }).allowed);
}
async function handleFeishuVcMeetingInvited(params) {
    const { cfg, event, runtime, chatHistories, accountId } = params;
    const log = runtime?.log ?? ((...args) => logger.info(args.map(String).join(' ')));
    const error = runtime?.error ?? ((...args) => logger.error(args.map(String).join(' ')));
    const syntheticEvent = buildSyntheticEvent(event);
    if (!syntheticEvent) {
        log(`feishu[${accountId}]: vc invited event missing meeting_no or inviter identity, skipping`);
        return;
    }
    const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
    const accountScopedCfg = {
        ...cfg,
        channels: { ...cfg.channels, feishu: account.config },
    };
    const accountFeishuCfg = account.config;
    // ---- Access policy enforcement (DM-style) ----
    // VC invited events are user-triggered service events. Align their access
    // semantics with direct-message/comment flows so unpaired users cannot
    // trigger agent behavior through event ingress.
    const dmPolicy = accountFeishuCfg?.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') {
        log(`feishu[${accountId}]: vc invited event rejected (dmPolicy=disabled)`);
        return;
    }
    if (dmPolicy !== 'open') {
        const configAllowFrom = accountFeishuCfg?.allowFrom ?? [];
        const storeAllowFrom = await (0, gate_1.readFeishuAllowFromStore)(account.accountId).catch(() => []);
        const combinedAllowFrom = [...configAllowFrom, ...storeAllowFrom];
        const allowed = matchesAnySenderId({
            allowFrom: combinedAllowFrom,
            senderIds: [
                syntheticEvent.senderOpenId,
                syntheticEvent.senderUserId,
                syntheticEvent.senderUnionId,
            ],
        });
        if (!allowed) {
            if (dmPolicy === 'pairing') {
                if (syntheticEvent.senderOpenId) {
                    log(`feishu[${accountId}]: vc inviter not paired, creating pairing request`);
                    try {
                        await (0, gate_effects_1.sendPairingReply)({
                            senderId: syntheticEvent.senderOpenId,
                            chatId: syntheticEvent.senderOpenId,
                            accountId: account.accountId,
                            accountScopedCfg,
                        });
                    }
                    catch (pairingErr) {
                        log(`feishu[${accountId}]: failed to create pairing request for vc inviter: ${String(pairingErr)}`);
                    }
                }
                else {
                    log(`feishu[${accountId}]: vc inviter not paired and has no open_id for pairing reply, rejecting`);
                }
            }
            else {
                log(`feishu[${accountId}]: vc invited event rejected (dmPolicy=${dmPolicy}, inviter not in allowlist)`);
            }
            return;
        }
    }
    const ctx = buildSyntheticContext(syntheticEvent);
    log(`feishu[${accountId}]: vc meeting invited, dispatching synthetic inbound` +
        ` sender=${syntheticEvent.senderId} meeting_no=${syntheticEvent.meetingNo}`);
    try {
        await (0, dispatch_1.dispatchToAgent)({
            ctx,
            permissionError: undefined,
            mediaPayload: {},
            extraInboundFields: {
                SyntheticEventType: syntheticEvent.eventType,
                VcMeetingId: syntheticEvent.meetingId,
                VcMeetingNo: syntheticEvent.meetingNo,
                VcMeetingTopic: syntheticEvent.topic,
                VcInviterOpenId: syntheticEvent.senderOpenId,
                VcInviteTime: syntheticEvent.inviteTime,
                VcCallId: syntheticEvent.callId,
            },
            quotedContent: undefined,
            account,
            accountScopedCfg,
            cfg,
            runtime,
            chatHistories,
            historyLimit: 0,
            // VC events do not originate from a real IM message.
            replyToMessageId: undefined,
            commandAuthorized: false,
            skipTyping: true,
        });
    }
    catch (err) {
        error(`feishu[${accountId}]: error dispatching vc invited synthetic inbound: ${String(err)}`);
    }
}

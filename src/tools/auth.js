"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_auth — the plugin's only remaining tool.
 *
 * Business capability lives in lark-cli; the one thing a CLI cannot do from
 * inside a chat is *ask the user to authorize in a place they can tap*. So this
 * tool drives lark-cli's device flow and renders the result as a Feishu card:
 *
 *   authorize -> lark-cli auth login --no-wait --json  (returns url + device_code)
 *             -> card with a button + the raw URL + the user code
 *   complete  -> lark-cli auth login --device-code <code>   (after the user says done)
 *   status    -> lark-cli auth status --json
 *   revoke    -> lark-cli auth logout
 *
 * The account is the conversation's account unless accountId is passed, and it
 * maps to a lark-cli profile via the same resolver the prompt uses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFeishuAuthTool = registerFeishuAuthTool;
const node_child_process_1 = require("node:child_process");
const typebox_1 = require("@sinclair/typebox");
const profiles_1 = require("../larkcli/profiles.js");
const accounts_1 = require("../core/accounts.js");
const lark_ticket_1 = require("../core/lark-ticket.js");
const send_1 = require("../messaging/outbound/send.js");
const oauth_cards_1 = require("./oauth-cards.js");
const helpers_1 = require("./helpers.js");
const lark_logger_1 = require("../core/lark-logger.js");
const log = (0, lark_logger_1.larkLogger)('tools/auth');
const COMPLETE_TIMEOUT_MS = 120000;
const FeishuAuthSchema = typebox_1.Type.Object({
    action: typebox_1.Type.Union([
        typebox_1.Type.Literal('authorize'),
        typebox_1.Type.Literal('complete'),
        typebox_1.Type.Literal('status'),
        typebox_1.Type.Literal('revoke'),
    ], {
        description: 'authorize=生成授权链接并发送卡片；complete=用户确认后完成授权；status=查看授权状态；revoke=撤销授权',
    }),
    device_code: typebox_1.Type.Optional(typebox_1.Type.String({
        description: 'authorize 返回的 device_code。action=complete 时必填',
    })),
});
/** Run the wrapper with the fence off: the plugin re-fences its own result. */
function runLark(profile, args, timeoutMs) {
    const bin = (0, profiles_1.wrapperPath)();
    const res = (0, node_child_process_1.spawnSync)(bin, ['--profile', profile].concat(args), {
        encoding: 'utf8',
        timeout: timeoutMs || 30000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
            ...process.env,
            OPENCLAW_HOME: (0, profiles_1.openclawHome)(),
            FEISHU_LARK_NO_FENCE: '1',
        },
    });
    return {
        status: typeof res.status === 'number' ? res.status : res.signal ? 1 : 0,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        timedOut: res.error ? String(res.error.message || '').includes('ETIMEDOUT') : false,
        error: res.error ? res.error.message : undefined,
    };
}
/** lark-cli prints JSON; tolerate a fenced or notice-wrapped payload. */
function parseJson(text) {
    if (!text) return undefined;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return undefined;
    }
}
function userCodeFrom(url) {
    if (typeof url !== 'string') return undefined;
    const m = url.match(/[?&]user_code=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
}
function buildCard(params) {
    const inAppUrl = (0, oauth_cards_1.toInAppWebUrl)(params.url, params.brand);
    const multiUrl = { url: inAppUrl, pc_url: inAppUrl, android_url: inAppUrl, ios_url: inAppUrl };
    return {
        schema: '2.0',
        config: { wide_screen_mode: false },
        header: {
            title: { tag: 'plain_text', content: '需要你授权飞书账号' },
            template: 'blue',
        },
        body: {
            elements: [
                {
                    tag: 'markdown',
                    content: '以 **' + params.account + '** 账号执行用户身份操作前，需要你完成一次授权（' +
                        params.expiresMin + ' 分钟内有效）。',
                },
                {
                    tag: 'column_set',
                    flex_mode: 'none',
                    horizontal_align: 'right',
                    columns: [{
                            tag: 'column',
                            width: 'auto',
                            elements: [{
                                    tag: 'button',
                                    text: { tag: 'plain_text', content: '打开授权页' },
                                    type: 'primary',
                                    size: 'medium',
                                    multi_url: multiUrl,
                                }],
                        }],
                },
                {
                    tag: 'markdown',
                    content: '或复制链接：' + params.url +
                        (params.userCode ? '\n授权码：**' + params.userCode + '**' : '') +
                        '\n完成后回我一句"授权好了"，我会继续。',
                    text_size: 'notation',
                },
            ],
        },
    };
}
async function sendAuthCard(cfg, accountId, card) {
    const ticket = (0, lark_ticket_1.getTicket)();
    if (!ticket || !ticket.chatId) return false;
    try {
        await (0, send_1.sendCardFeishu)({
            cfg,
            to: ticket.chatId,
            card,
            replyToMessageId: ticket.messageId,
            accountId,
        });
        return true;
    } catch (err) {
        log.warn('failed to send auth card: ' + (err instanceof Error ? err.message : String(err)));
        return false;
    }
}
function resolveAccount(cfg, params) {
    const ticket = (0, lark_ticket_1.getTicket)();
    const accountId = params.accountId || (ticket && ticket.accountId) || undefined;
    const account = (0, accounts_1.getLarkAccount)(cfg, accountId);
    return {
        accountId: account.accountId,
        profile: (0, profiles_1.resolveProfileName)(cfg, account.accountId),
        brand: account.brand || 'feishu',
        configured: account.configured,
    };
}
function registerFeishuAuthTool(api) {
    if (!api.config) return;
    const cfg = api.config;
    (0, helpers_1.registerTool)(api, {
        name: 'feishu_auth',
        label: 'Feishu: 用户授权（lark-cli device flow）',
        description: '飞书用户身份授权管理。业务操作走 lark-cli；当命令报缺少用户身份（missing user identity）时用本工具：' +
            'action=authorize 生成授权链接并给你一张卡片（把它转给用户），用户确认后 action=complete 传回 device_code 完成授权。' +
            'action=status 查状态，action=revoke 撤销。不要用它做业务读写。',
        parameters: FeishuAuthSchema,
        async execute(_toolCallId, params) {
            const p = params || {};
            const target = resolveAccount(cfg, p);
            if (!target.configured) {
                return (0, helpers_1.formatToolError)('当前账号未配置 appId/appSecret，无法授权', { accountId: target.accountId });
            }
            try {
                if (p.action === 'authorize') {
                    const res = runLark(target.profile, ['auth', 'login', '--no-wait', '--json'], 30000);
                    const data = parseJson(res.stdout);
                    if (!data || !data.verification_url) {
                        return (0, helpers_1.formatToolError)(
                            '生成授权链接失败：' + (res.stderr || res.stdout || 'no output').trim().slice(0, 400),
                            { accountId: target.accountId, profile: target.profile },
                        );
                    }
                    const userCode = userCodeFrom(data.verification_url);
                    const expiresMin = Math.max(1, Math.round((data.expires_in || 600) / 60));
                    const cardSent = await sendAuthCard(cfg, target.accountId, buildCard({
                        url: data.verification_url,
                        userCode,
                        expiresMin,
                        account: target.accountId,
                        brand: target.brand,
                    }));
                    return (0, helpers_1.formatToolResult)({
                        ok: true,
                        account: target.accountId,
                        profile: target.profile,
                        verification_url: data.verification_url,
                        user_code: userCode,
                        expires_in_seconds: data.expires_in,
                        card_sent: cardSent,
                        next_step: '把链接发给用户（卡片已自动发送时只需提示查看卡片），用户说完成后再调用本工具 action=complete 并传 device_code',
                        device_code: data.device_code,
                    });
                }
                if (p.action === 'complete') {
                    if (!p.device_code) {
                        return (0, helpers_1.formatToolError)('action=complete 需要 device_code（authorize 的返回值里有）');
                    }
                    const res = runLark(target.profile, ['auth', 'login', '--device-code', p.device_code, '--json'], COMPLETE_TIMEOUT_MS);
                    const data = parseJson(res.stdout);
                    if (res.status === 0 && data && data.ok !== false) {
                        return (0, helpers_1.formatToolResult)({ ok: true, account: target.accountId, profile: target.profile, identity: 'user', detail: data });
                    }
                    return (0, helpers_1.formatToolError)(
                        (res.timedOut
                            ? '等待授权超时（用户可能还没完成）。让用户完成后重试 action=complete。'
                            : '授权未完成：') + (res.stderr || res.stdout || '').trim().slice(0, 400),
                        { accountId: target.accountId, profile: target.profile },
                    );
                }
                if (p.action === 'status') {
                    const res = runLark(target.profile, ['auth', 'status', '--json'], 30000);
                    const data = parseJson(res.stdout);
                    if (!data) {
                        return (0, helpers_1.formatToolError)('查询授权状态失败：' + (res.stderr || res.stdout || '').trim().slice(0, 300));
                    }
                    const user = data.identities && data.identities.user ? data.identities.user : {};
                    return (0, helpers_1.formatToolResult)({
                        account: target.accountId,
                        profile: target.profile,
                        app_id: data.appId,
                        identity: data.identity,
                        user_status: user.status,
                        user_available: user.available,
                    });
                }
                if (p.action === 'revoke') {
                    const res = runLark(target.profile, ['auth', 'logout', '--json'], 30000);
                    if (res.status !== 0) {
                        return (0, helpers_1.formatToolError)('撤销失败：' + (res.stderr || res.stdout || '').trim().slice(0, 300));
                    }
                    return (0, helpers_1.formatToolResult)({ ok: true, account: target.accountId, profile: target.profile, revoked: true });
                }
                return (0, helpers_1.formatToolError)('未知 action：' + String(p.action));
            }
            catch (err) {
                return (0, helpers_1.formatToolError)(err instanceof Error ? err.message : String(err), { accountId: target.accountId });
            }
        },
    });
}

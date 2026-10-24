"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * /feishu auth — user authorization guidance.
 *
 * The plugin no longer owns a user-token store (that whole stack was removed in
 * 2026.10.10): authorization belongs to lark-cli, and the agent triggers it with
 * the feishu_auth tool, which sends a card with a tappable authorization link.
 * This command therefore only explains the flow and points at the status view.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeishuAuth = runFeishuAuth;
exports.runFeishuAuthI18n = runFeishuAuthI18n;
const lark_client_1 = require("../core/lark-client.js");
const profiles_1 = require("../larkcli/profiles.js");
const T = {
    zh_cn: {
        title: '**飞书用户授权**',
        intro: '用户授权现在由 lark-cli 负责（插件不再保存用户 token）。',
        how: [
            '1. 直接跟 agent 说要做什么（比如"读一下我云盘里最新的文档"）。',
            '2. 需要用户身份时，agent 会调用「feishu_auth」工具，给你一张带"打开授权页"按钮的卡片。',
            '3. 点开完成授权，回来跟 agent 说一声，它会继续。',
        ],
        manual: '也可以手动执行：',
        statusHint: '查看当前各账号的授权与 profile 映射：/feishu larkcli status',
    },
    en_us: {
        title: '**Feishu user authorization**',
        intro: 'User authorization is owned by lark-cli now; the plugin keeps no user token.',
        how: [
            '1. Just ask the agent to do the work (e.g. "read the latest doc in my drive").',
            '2. When user identity is required, the agent calls the feishu_auth tool and sends you a card with an "Authorize" button.',
            '3. Finish it in the browser, tell the agent, and it continues.',
        ],
        manual: 'Or do it manually:',
        statusHint: 'Check per-account authorization and profile mapping: /feishu larkcli status',
    },
};
function render(cfg, locale) {
    const t = T[locale];
    const bin = (0, profiles_1.resolveLarkCliBinary)(cfg);
    const wrapper = (0, profiles_1.wrapperPath)();
    const lines = [t.title, '', t.intro, '', ...t.how, ''];
    if (bin) {
        lines.push(t.manual);
        lines.push('~~~');
        lines.push(wrapper + ' --profile <account> auth login');
        lines.push('~~~');
        lines.push('');
    }
    lines.push(t.statusHint);
    return lines.join('\n');
}
async function runFeishuAuth(cfg) {
    return render(lark_client_1.LarkClient.globalConfig || cfg, 'zh_cn');
}
async function runFeishuAuthI18n(cfg) {
    const global = lark_client_1.LarkClient.globalConfig || cfg;
    return { zh_cn: render(global, 'zh_cn'), en_us: render(global, 'en_us') };
}

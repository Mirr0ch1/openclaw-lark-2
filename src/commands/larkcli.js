"use strict";
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * /feishu larkcli [status|sync]
 *
 * Surfaces the account -> lark-cli profile mapping. Business capability now
 * lives in the CLI, so this mapping *is* the plugin's integration health: a
 * profile that is missing, or that points at a different appId, silently sends
 * every operation to the wrong Feishu app.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFeishuLarkcli = runFeishuLarkcli;
const node_child_process_1 = require("node:child_process");
const profiles_1 = require("../larkcli/profiles.js");
const lark_client_1 = require("../core/lark-client.js");
const T = {
    zh_cn: {
        title: '**飞书 CLI 身份映射**',
        binary: 'CLI 二进制',
        wrapper: '包装器',
        tableHeader: '| 账号 | lark-cli profile | 状态 | 说明 |',
        tableDivider: '|------|------------------|------|------|',
        ok: '✅ 就绪',
        fail: '❌ 异常',
        identity: (id, tok) => '身份 ' + id + ' / token ' + tok,
        notFound: '未找到 lark-cli（npm i -g @larksuite/cli）',
        disabled: '已由配置禁用（channels.feishu.larkCli.enabled=false）',
        syncTitle: '**lark-cli profile 同步结果**',
        created: '新建',
        updated: '重建',
        skipped: '已存在（跳过）',
        failed: '失败',
        backup: '配置备份',
        hint: '提示：显式指定账号时用 --profile <账号>；不要用 lark-cli profile use（进程级全局状态）。',
        store: 'Profile 存储',
        storeBound: '（已绑定 OpenClaw，agent 的 exec 只读这个）',
        storeGlobal: '（未绑定；agent exec 带有 OPENCLAW_HOME，会读 ~/.lark-cli/openclaw/config.json，与这里不一致！）',
        adopted: '沿用已有 profile',
        repaired: '凭证已修复',
    },
    en_us: {
        title: '**Lark CLI identity mapping**',
        binary: 'CLI binary',
        wrapper: 'Wrapper',
        tableHeader: '| Account | lark-cli profile | Status | Detail |',
        tableDivider: '|---------|------------------|--------|--------|',
        ok: '✅ ready',
        fail: '❌ broken',
        identity: (id, tok) => 'identity ' + id + ' / token ' + tok,
        notFound: 'lark-cli not found (npm i -g @larksuite/cli)',
        disabled: 'disabled by config (channels.feishu.larkCli.enabled=false)',
        syncTitle: '**lark-cli profile sync**',
        created: 'created',
        updated: 'recreated',
        skipped: 'skipped (already matches)',
        failed: 'failed',
        backup: 'config backup',
        hint: 'Tip: name the account explicitly with --profile <account>; never use lark-cli profile use (process-global state).',
        store: 'Profile store',
        storeBound: ' (OpenClaw-bound; agent exec reads only this one)',
        storeGlobal: ' (not bound; agent exec carries OPENCLAW_HOME and reads ~/.lark-cli/openclaw/config.json instead!)',
        adopted: 'adopted existing profile',
        repaired: 'credentials repaired',
    },
};
function cliVersion(bin) {
    if (!bin)
        return undefined;
    const res = (0, node_child_process_1.spawnSync)(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
    const out = (res.stdout || '').trim().split('\n')[0];
    return out || undefined;
}
function formatStatus(cfg, locale) {
    const t = T[locale];
    const bin = (0, profiles_1.resolveLarkCliBinary)(cfg);
    const lines = [];
    lines.push(t.title);
    lines.push('');
    lines.push(t.binary + ': ' + (bin ? bin + ' (' + (cliVersion(bin) || 'unknown version') + ')' : t.notFound));
    lines.push(t.wrapper + ': ' + (0, profiles_1.wrapperPath)());
    const boundConfig = require('node:path').join(process.env.HOME || '', '.lark-cli', 'openclaw', 'config.json');
    const bound = require('node:fs').existsSync(boundConfig);
    lines.push(t.store + ': ' + (bound ? boundConfig + t.storeBound : '~/.lark-cli/config.json' + t.storeGlobal));
    lines.push('');
    if (!bin) {
        lines.push(t.notFound);
        return lines.join('\n');
    }
    const rows = (0, profiles_1.healthCheck)(cfg);
    lines.push(t.tableHeader);
    lines.push(t.tableDivider);
    for (const row of rows) {
        const detail = row.ok
            ? t.identity(row.identity || '-', row.tokenStatus || '-')
            : row.error || '-';
        lines.push('| ' + row.accountId + ' | ' + row.profile + ' | ' + (row.ok ? t.ok : t.fail) + ' | ' + detail + ' |');
    }
    lines.push('');
    if (rows.some((r) => !r.ok))
        lines.push(t.failed + ' -> /feishu larkcli sync');
    lines.push(t.hint);
    return lines.join('\n');
}
function formatSync(result, locale) {
    const t = T[locale];
    const lines = [];
    lines.push(t.syncTitle);
    lines.push('');
    if (result.created.length)
        lines.push('- ' + t.created + ': ' + result.created.join(', '));
    if (result.updated.length)
        lines.push('- ' + t.updated + ': ' + result.updated.join(', '));
    if (result.adopted && result.adopted.length)
        lines.push('- ' + t.adopted + ': ' + result.adopted.join(', '));
    if (result.repaired && result.repaired.length)
        lines.push('- ' + t.repaired + ': ' + result.repaired.join(', '));
    if (result.skipped.length)
        lines.push('- ' + t.skipped + ': ' + result.skipped.join(', '));
    for (const f of result.failed)
        lines.push('- ' + t.failed + ' [' + f.accountId + ']: ' + f.error);
    if (result.backup)
        lines.push('- ' + t.backup + ': ' + result.backup);
    lines.push('');
    lines.push(result.ok ? '✅ 全部同步完成' : '❌ 存在失败项');
    return lines.join('\n');
}
/**
 * Run the larkcli command.
 *
 * @param cfg   Plugin config (global config, so every account is visible).
 * @param opts  action: 'status' (default) or 'sync'; force: recreate a profile
 *              whose appId drifted.
 */
async function runFeishuLarkcli(inputCfg, opts) {
    // Commands receive an account-scoped config where the accounts map has been
    // replaced by the current account. Enumerating every account needs the
    // global config (same rule as the doctor command).
    const cfg = lark_client_1.LarkClient.globalConfig || inputCfg;
    const options = opts || {};
    const locale = options.locale === 'en_us' ? 'en_us' : 'zh_cn';
    try {
        if (options.action === 'sync') {
            (0, profiles_1.ensureStableWrapper)();
            return formatSync((0, profiles_1.provisionProfiles)(cfg, { force: Boolean(options.force) }), locale);
        }
        return formatStatus(cfg, locale);
    }
    catch (err) {
        return '❌ ' + (err instanceof Error ? err.message : String(err));
    }
}

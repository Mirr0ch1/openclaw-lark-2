"use strict";
/**
 * openclaw-lark-2 工具可用性 dry-run 检查
 *
 * 三层检查：
 *   1. 注册层：mock PluginApi 跑一遍 register()，验证 2.0 注册 API 兼容
 *   2. SDK 路径：提取工具里所有 `sdk.<path>`，验证在 @larksuiteoapi/node-sdk
 *      实例上是真实函数
 *   3. 真实只读冒烟：用真实配置 + ToolClient 调用几个只读 API，验证
 *      账号→token→scope→invoke 链路
 *
 * 用法（在插件根目录执行）：
 *   node scripts/check-tools.js
 *
 * 判定说明：
 *   - "应用缺少权限 [xxx]" = 链路正常，只是 app 没开 scope（去开放平台开权限即可）
 *   - "need_user_authorization" = 用户未授权 UAT（跑 feishu_oauth 授权即可）
 *   - SDK path 非函数 / register() 抛错 = 真正的 2.0 适配 bug
 */
const fs = require('node:fs');
const path = require('node:path');

// Repo may not have node_modules; the installed plugin dir does (openclaw symlink + lark SDK).
const repoRoot = path.join(__dirname, '..');
const installedRoot = path.join(process.env.HOME || '/home/mirro', '.openclaw', 'extensions', 'openclaw-lark-2');
const root = fs.existsSync(path.join(repoRoot, 'node_modules')) ? repoRoot : installedRoot;
const CONFIG_PATH = process.env.OPENCLAW_CONFIG || path.join(process.env.HOME || '/home/mirro', '.openclaw', 'openclaw.json');

// ---------------------------------------------------------------------------
// Layer 1 — registration dry-run
// ---------------------------------------------------------------------------
function registrationCheck() {
    const registered = [];
    const errors = [];
    const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: (m) => errors.push(String(m)) };

    // Enable ALL tool categories + clear deny so every feishu tool registers.
    const allCats = { doc: true, wiki: true, drive: true, perm: true, scopes: true, mail: true, sheets: true, okr: true };
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg.channels = cfg.channels || {};
    cfg.channels.feishu = cfg.channels.feishu || {};
    cfg.channels.feishu.tools = { ...(cfg.channels.feishu.tools || {}), ...allCats, deny: [] };
    for (const acc of Object.values(cfg.channels.feishu.accounts || {})) acc.tools = { ...(acc.tools || {}), ...allCats };

    const mockApi = new Proxy({}, {
        get(_t, prop) {
            if (prop === 'config') return cfg;
            if (prop === 'logger') return mockLogger;
            if (prop === 'runtime') {
                return { logging: { getChildLogger: () => mockLogger }, config: { current: () => cfg } };
            }
            if (prop === 'registerTool') {
                return (tool) => {
                    if (!tool || typeof tool !== 'object') { errors.push('registerTool non-object: ' + String(tool)); return; }
                    registered.push({ name: tool.name, hasParams: Boolean(tool.parameters), execute: typeof tool.execute });
                };
            }
            return () => undefined;
        },
    });

    try {
        const mod = require(path.join(root, 'index.js'));
        (mod.default || mod).register(mockApi);
        const bad = registered.filter((t) => !t.name || !t.hasParams || t.execute !== 'function');
        console.log(`[注册层] register() OK, tools=${registered.length}, errors=${errors.length}, malformed=${bad.length}`);
        bad.forEach((t) => console.log('  BAD:', JSON.stringify(t)));
        return { ok: errors.length === 0 && bad.length === 0, count: registered.length };
    }
    catch (err) {
        console.log(`[注册层] FATAL register() threw: ${err.message}`);
        return { ok: false, count: 0 };
    }
}

// ---------------------------------------------------------------------------
// Layer 2 — SDK path function-existence check
// ---------------------------------------------------------------------------
function sdkPathCheck() {
    const Lark = require(path.join(root, 'node_modules', '@larksuiteoapi', 'node-sdk'));
    const client = new Lark.Client({ appId: 'cli_dryrun', appSecret: 'x' });
    const paths = new Set();
    (function scan(dir) {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) scan(p);
            else if (f.endsWith('.js')) {
                for (const m of fs.readFileSync(p, 'utf8').matchAll(/sdk\.([a-zA-Z_]+(?:\.[a-zA-Z0-9_]+)+)/g)) paths.add(m[1]);
            }
        }
    })(path.join(root, 'src/tools'));
    const broken = [];
    for (const p of [...paths].sort()) {
        let cur = client;
        for (const part of p.split('.')) {
            if (cur == null || !(part in Object(cur))) { cur = undefined; break; }
            cur = cur[part];
        }
        if (typeof cur !== 'function') broken.push(`${p} (${typeof cur})`);
    }
    console.log(`[SDK路径] unique=${paths.size}, non-function=${broken.length}`);
    broken.forEach((b) => console.log('  BROKEN:', b));
    return { ok: broken.length === 0, count: paths.size };
}

// ---------------------------------------------------------------------------
// Layer 3 — CLI delegation smoke (the plugin's real integration path now)
// ---------------------------------------------------------------------------
async function cliSmoke() {
    const profiles = require(path.join(root, 'src', 'larkcli', 'profiles.js'));
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const bin = profiles.resolveLarkCliBinary(cfg);
    console.log('[CLI委派] lark-cli:', bin || 'NOT FOUND');
    if (!bin) return { ok: false };
    console.log('  wrapper:', profiles.wrapperPath());
    const rows = profiles.healthCheck(cfg);
    for (const r of rows) {
        console.log(`  ${r.accountId} -> profile ${r.profile}: ${r.ok ? 'OK' : 'FAIL'} ${r.identity || ''} ${r.error || ''}`);
    }
    return { ok: rows.every((r) => r.ok) };
}

(async () => {
    console.log('=== openclaw-lark-2 工具 dry-run ===');
    const r1 = registrationCheck();
    const r2 = sdkPathCheck();
    const r3 = await cliSmoke();
    console.log('\n结论:', r1.ok && r2.ok && r3.ok ? '注册层 + SDK 路径 + CLI 委派均通过' : '发现问题，见上');
})();

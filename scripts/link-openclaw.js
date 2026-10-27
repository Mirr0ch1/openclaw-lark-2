"use strict";
/**
 * 确保 node_modules/openclaw 指向本机已安装的 OpenClaw。
 *
 * 背景：`openclaw` 这个依赖不是从 npm 仓库装的（它是宿主程序本身），开发
 *  checkout 里的 `node_modules/openclaw` 是一个指向本机 OpenClaw 安装目录的
 * 符号链接。任何 `npm install` 都会把这个"非注册依赖"删掉，导致后续
 * `require('openclaw/plugin-sdk/...')` 全部失败 —— 表现为测试大面积报
 * "Cannot find module 'openclaw/plugin-sdk/...'".
 *
 * 这个 postinstall 钩子把链接补回来。找不到全局 OpenClaw 时静默跳过：
 * 那说明使用者是在一个没有宿主的纯开发环境里，不该因此让安装失败。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const linkPath = path.join(repoRoot, 'node_modules', 'openclaw');

/** Locate the globally installed OpenClaw package directory. */
function findGlobalOpenClaw() {
    try {
        const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const candidate = path.join(globalRoot, 'openclaw');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    catch {
        // npm not on PATH — fall through.
    }
    return undefined;
}

function main() {
    const target = findGlobalOpenClaw();
    if (!target) {
        console.warn('[openclaw-lark-2] global openclaw not found — skipped linking node_modules/openclaw.');
        return;
    }
    // Always point at the host's OpenClaw install. A registry-installed copy
    // would shadow the host's plugin-sdk in standalone runs, and the host
    // already provides `openclaw/plugin-sdk/*` at runtime — the plugin must
    // never carry its own copy.
    let current;
    try {
        current = fs.lstatSync(linkPath);
    }
    catch {
        current = undefined;
    }
    if (current?.isSymbolicLink()) {
        const resolved = fs.realpathSync(linkPath);
        if (resolved === fs.realpathSync(target)) {
            return;
        }
    }
    if (current) {
        fs.rmSync(linkPath, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath, 'dir');
    console.log(`[openclaw-lark-2] linked node_modules/openclaw -> ${target}`);
}

main();

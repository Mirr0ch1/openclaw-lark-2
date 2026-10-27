"use strict";
/**
 * 未定义标识符检查（tsc --checkJs 的精简版）
 *
 * 背景：本插件的运行时代码是普通 JS（无类型检查、无 lint）。一次真实事故：
 * `dispatchToAgent` 里引用了另一个函数中的局部变量 `effectiveSessionKey`，
 * 运行时抛 `ReferenceError`，**每一条命令消息**（`/status` `/stop` …）都在
 * 派发前崩溃，于是飞书里既没有回复也没有错误提示——普通消息因为没走到那行
 * 所以看起来"正常"。
 *
 * `tsc --checkJs` 能在编译期报出 `TS2304: Cannot find name 'effectiveSessionKey'`，
 * 正好覆盖这类事故。这里只挑"未定义标识符"这一类错误，其余诊断（手写 .d.ts
 * 里的 zod 语法等）一律忽略——本脚本的职责单一：保证实现文件里没有引用到
 * 作用域外却没声明的名字。
 *
 * 用法（在插件根目录执行）：
 *   node scripts/check-undef.js
 *
 * 退出码：0 = 干净；1 = 有未定义标识符；2 = 缺少 typescript 依赖。
 */
const fs = require('node:fs');
const path = require('node:path');

// 只关心"这个名字根本没声明"这一类诊断。
const UNDEFINED_NAME_CODES = new Set([
    2304, // Cannot find name 'x'.
    2552, // Cannot find name 'x'. Did you mean 'y'?
    2451, // Cannot redeclare block-scoped variable 'x'.
    2305, // Module 'x' has no exported member 'y'.
    2448, // Property 'x' does not exist on type 'never'.
    2454, // Variable 'x' is used before being assigned.
    2664, // Cannot find name 'x'. Did you mean the module member 'y'?
]);
const TS_OPTIONS = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: 9, // ES2022
    module: 100, // Node16
    moduleResolution: 100, // Node16
};
/** Recursively collect the plugin's implementation files. */
function collectJsFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJsFiles(full));
        }
        else if (entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}
/**
 * Check the plugin's implementation files for undefined identifiers.
 *
 * @param {string} root Plugin root (the directory holding `src/`).
 * @returns {{ available: boolean, offenders: Array<{ file: string, line: number, column: number, message: string }> }}
 */
function checkUndefinedIdentifiers(root) {
    let ts;
    try {
        ts = require('typescript');
    }
    catch {
        return { available: false, offenders: [] };
    }
    const srcDir = path.join(root, 'src');
    if (!fs.existsSync(srcDir)) {
        return { available: true, offenders: [] };
    }
    const files = collectJsFiles(srcDir);
    if (files.length === 0) {
        return { available: true, offenders: [] };
    }
    const program = ts.createProgram(files, TS_OPTIONS);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const offenders = [];
    for (const diagnostic of diagnostics) {
        if (!diagnostic.file || !diagnostic.file.fileName.endsWith('.js')) {
            continue;
        }
        if (!UNDEFINED_NAME_CODES.has(diagnostic.code)) {
            continue;
        }
        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        offenders.push({
            file: path.relative(root, diagnostic.file.fileName),
            line: position.line + 1,
            column: position.character + 1,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        });
    }
    return { available: true, offenders };
}
exports.checkUndefinedIdentifiers = checkUndefinedIdentifiers;
// Standalone mode.
if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const result = checkUndefinedIdentifiers(root);
    if (!result.available) {
        console.error('typescript is not installed — run `npm install` in the plugin root.');
        process.exit(2);
    }
    if (result.offenders.length === 0) {
        console.log('ok: no undefined identifiers in src/**/*.js');
        process.exit(0);
    }
    console.error(`${result.offenders.length} undefined identifier(s) found:`);
    for (const offender of result.offenders) {
        console.error(`  ${offender.file}:${offender.line}:${offender.column}  ${offender.message}`);
    }
    process.exit(1);
}

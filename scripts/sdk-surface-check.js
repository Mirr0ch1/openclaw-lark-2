'use strict';
/**
 * Compare the OpenClaw plugin-SDK surface this plugin imports against the
 * surface the host OpenClaw actually exposes.
 *
 * OpenClaw keeps removing and renaming `plugin-sdk/*` subpaths between
 * releases. Each such change breaks the plugin at load time with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` ("cannot import openclaw/plugin-sdk/<subpath>
 * (built with OpenClaw X; running core Y)"), so this check turns a crash on the
 * operator's machine into a failure in the development checkout.
 *
 * The manifest lists every subpath and named export that the shipped `src/`
 * imports. Regenerate it after touching imports:
 *
 *   node scripts/sdk-surface-check.js --write
 *
 * Usage:
 *   const { checkPluginSdkSurface } = require('./scripts/sdk-surface-check.js');
 *   const report = checkPluginSdkSurface(pluginRoot, '/usr/lib/node_modules/openclaw/package.json');
 *
 *   // { hostVersion, subpaths, missingSubpaths, missingSymbols, manifestError }
 *
 * Set OPENCLAW_PACKAGE_DIR to validate against a specific OpenClaw install.
 */
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = 'scripts/sdk-surface.json';
const SRC_DIR = 'src';
const ENTRY_FILES = ['index.js'];
const SDK_PREFIX = 'openclaw/plugin-sdk/';

/**
 * Load the surface manifest, or extract it from the shipped JS when the
 * manifest is missing (checkout that predates the manifest).
 * @param {string} pluginRoot
 * @returns {{ subpaths: Record<string, string[]>, manifestError?: string }}
 */
function readManifest(pluginRoot) {
    const manifestPath = path.join(pluginRoot, MANIFEST);
    if (!fs.existsSync(manifestPath)) {
        if (!fs.existsSync(path.join(pluginRoot, SRC_DIR))) {
            return { subpaths: {}, manifestError: `missing ${MANIFEST} and no ${SRC_DIR}/ to scan` };
        }
        return { subpaths: extractSurface(pluginRoot) };
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
    catch (error) {
        return { subpaths: {}, manifestError: `cannot parse ${MANIFEST}: ${error.message}` };
    }
    const subpaths = parsed && typeof parsed === 'object' && parsed.subpaths;
    if (!subpaths || typeof subpaths !== 'object') {
        return { subpaths: {}, manifestError: `${MANIFEST} must be { "subpath": ["symbol", ...] }` };
    }
    return { subpaths };
}

/**
 * Collect `<alias>.<symbol>` usage for every `require("openclaw/plugin-sdk/<sub>")`.
 * @param {string} root
 * @returns {Record<string, string[]>}
 */
function extractSurface(root) {
    const surface = {};
    const ensure = (subpath) => surface[subpath] ?? (surface[subpath] = new Set());

    // Only the shipped runtime counts: src/ plus the package entry points.
    const files = [
        ...listJsFiles(path.join(root, SRC_DIR)),
        ...ENTRY_FILES.map((name) => path.join(root, name)).filter((file) => fs.existsSync(file)),
    ];

    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');

        // `const ssrf_1 = require("openclaw/plugin-sdk/ssrf-runtime")` + `ssrf_1.foo`
        for (const [, alias, subpath] of source.matchAll(
            /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*require\("openclaw\/plugin-sdk\/([a-z0-9.-]+)"\)/g,
        )) {
            const symbols = ensure(subpath);
            const aliasRe = new RegExp(`\\b${alias.replace(/\$/g, '\\$')}\\.([A-Za-z0-9_$]+)`, 'g');
            for (const [, symbol] of source.matchAll(aliasRe)) symbols.add(symbol);
        }

        // `const { fetchWithSsrFGuard } = require("openclaw/plugin-sdk/ssrf-runtime")`
        for (const [, names, subpath] of source.matchAll(
            /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\("openclaw\/plugin-sdk\/([a-z0-9.-]+)"\)/g,
        )) {
            const symbols = ensure(subpath);
            for (const raw of names.split(',')) {
                const part = raw.trim();
                if (!part) continue;
                const as = part.split(/\s+as\s+/);
                symbols.add((as[1] ?? as[0]).trim());
            }
        }
    }

    // Sorted keys + symbols keep the generated manifest diff-stable.
    return Object.fromEntries(
        Object.keys(surface)
            .sort()
            .map((subpath) => [subpath, [...surface[subpath]].sort()]),
    );
}

/** @param {string} dir */
function listJsFiles(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.git') found.push(...listJsFiles(full));
            continue;
        }
        if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
}

/** Locate the OpenClaw package.json backing this checkout. */
function resolveHostOpenClaw(pluginRoot) {
    if (process.env.OPENCLAW_PACKAGE_DIR) {
        return path.join(process.env.OPENCLAW_PACKAGE_DIR, 'package.json');
    }
    const linked = path.join(pluginRoot, 'node_modules', 'openclaw', 'package.json');
    if (fs.existsSync(linked)) return linked;
    return require.resolve('openclaw/package.json', { paths: [pluginRoot] });
}

/**
 * Read the host OpenClaw manifest and the names each `plugin-sdk/*` subpath
 * exposes, resolved through the package `exports` map (which is exactly what
 * Node enforces at require time).
 *
 * Symbols are read statically instead of by importing the module: a plugin-SDK
 * module pulls in the whole OpenClaw runtime, so importing it from a bare
 * install directory (or a second OpenClaw copy) fails for reasons unrelated to
 * the plugin.
 *
 * @param {string} hostPackageJsonPath
 */
function loadHost(hostPackageJsonPath) {
    const hostRoot = path.dirname(hostPackageJsonPath);
    const hostPackage = JSON.parse(fs.readFileSync(hostPackageJsonPath, 'utf8'));
    const exportsMap = hostPackage.exports ?? {};

    const subpaths = Object.keys(exportsMap)
        .filter((key) => key.startsWith('./plugin-sdk/'))
        .map((key) => key.slice('./plugin-sdk/'.length));

    return {
        version: hostPackage.version ?? 'unknown',
        subpaths,
        exportsOf(subpath) {
            const entry = exportsMap[`./plugin-sdk/${subpath}`];
            if (!entry) return { names: undefined, error: 'ERR_PACKAGE_PATH_NOT_EXPORTED' };
            const target = typeof entry === 'string' ? entry : entry.default ?? entry.import ?? entry.require;
            if (!target) return { names: undefined, error: 'ERR_PACKAGE_PATH_NOT_EXPORTED' };
            const file = path.join(hostRoot, target);
            if (!fs.existsSync(file)) return { names: undefined, error: 'ERR_MODULE_NOT_FOUND' };
            return { names: exportedNames(fs.readFileSync(file, 'utf8')), error: undefined };
        },
    };
}

/**
 * Names a bundled ESM/CJS module exports, from its source text.
 * @param {string} source
 * @returns {Set<string>}
 */
function exportedNames(source) {
    const names = new Set();
    for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const raw of list.split(',')) {
            const part = raw.trim();
            if (!part) continue;
            const as = part.split(/\s+as\s+/);
            names.add((as[1] ?? as[0]).trim());
        }
    }
    for (const [, name] of source.matchAll(/\bexports\.([A-Za-z0-9_$]+)\s*=/g)) names.add(name);
    for (const [, name] of source.matchAll(/Object\.defineProperty\(exports,\s*"([^"]+)"/g)) names.add(name);
    return names;
}

/**
 * Report which SDK subpaths and exports the plugin uses but this host lacks.
 * @param {string} pluginRoot
 * @param {string} [hostPackageJsonPath]
 */
function checkPluginSdkSurface(pluginRoot, hostPackageJsonPath) {
    const { subpaths, manifestError } = readManifest(pluginRoot);
    const used = Object.keys(subpaths).sort();

    let host;
    try {
        host = loadHost(hostPackageJsonPath ?? resolveHostOpenClaw(pluginRoot));
    }
    catch (error) {
        return {
            hostVersion: 'unknown',
            subpaths: used,
            manifest: subpaths,
            missingSubpaths: [],
            missingSymbols: [],
            manifestError: manifestError ?? `cannot inspect host OpenClaw: ${error.message}`,
        };
    }

    const missingSubpaths = used.filter((subpath) => !host.subpaths.includes(subpath));
    const missingSymbols = [];
    for (const subpath of used) {
        const { names, error } = host.exportsOf(subpath);
        if (error) {
            if (!missingSubpaths.includes(subpath)) missingSubpaths.push(subpath);
            continue;
        }
        for (const symbol of subpaths[subpath]) {
            if (!names.has(symbol)) missingSymbols.push(`${subpath}.${symbol}`);
        }
    }

    return {
        hostVersion: host.version,
        subpaths: used,
        manifest: subpaths,
        missingSubpaths,
        missingSymbols,
        manifestError,
    };
}

module.exports = { checkPluginSdkSurface, extractSurface, resolveHostOpenClaw };

// CLI: `node scripts/sdk-surface-check.js --write [--root <dir>]`
if (require.main === module) {
    const argv = process.argv;
    const root = path.resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : '.');
    if (argv.includes('--write')) {
        const surface = extractSurface(root);
        const target = path.join(root, MANIFEST);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const manifest = {
            generated: 'node scripts/sdk-surface-check.js --write',
            subpaths: surface,
        };
        fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`[sdk-surface] wrote ${path.relative(root, target)} (${Object.keys(surface).length} subpaths)`);
        for (const subpath of Object.keys(surface).sort()) {
            console.log(`  ${subpath}: ${surface[subpath].join(', ')}`);
        }
        process.exit(0);
    }
    const report = checkPluginSdkSurface(root);
    console.log(`[sdk-surface] host ${report.hostVersion}, ${report.subpaths.length} subpaths used`);
    if (report.manifestError) console.warn(`[sdk-surface] ${report.manifestError}`);
    if (report.missingSubpaths.length) console.error(`[sdk-surface] missing subpaths: ${report.missingSubpaths.join(', ')}`);
    if (report.missingSymbols.length) console.error(`[sdk-surface] missing exports: ${report.missingSymbols.join(', ')}`);
    process.exit(report.missingSubpaths.length || report.missingSymbols.length ? 1 : 0);
}
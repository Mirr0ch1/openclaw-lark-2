/**
 * Guard the OpenClaw plugin-SDK surface this plugin relies on.
 *
 * OpenClaw keeps removing, renaming and reshaping plugin-SDK subpaths between
 * releases. Each such change breaks this plugin at load time with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` ("cannot import openclaw/plugin-sdk/<subpath>
 * (built with OpenClaw X; running core Y)") — e.g. `command-auth` in 2026.10.1,
 * `channel-message` → `channel-outbound` and `config-runtime` (session store)
 * in 2026.11.
 *
 * `scripts/sdk-surface.json` lists every subpath and named export the shipped
 * `src/` imports. This test resolves them against the host OpenClaw that the
 * plugin actually runs on, so a load-breaking upgrade fails here instead of on
 * the operator's machine.
 *
 * Set `OPENCLAW_PACKAGE_DIR` to validate against another OpenClaw install.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkPluginSdkSurface, extractSurface } = require('../../scripts/sdk-surface-check.js');

const pluginRoot = path.resolve(__dirname, '../..');

/** Resolve the OpenClaw that backs this checkout (see scripts/link-openclaw.js). */
function hostOpenClawPath() {
  if (process.env.OPENCLAW_PACKAGE_DIR) {
    const packageJson = path.join(process.env.OPENCLAW_PACKAGE_DIR, 'package.json');
    if (existsSync(packageJson)) return packageJson;
  }
  const link = path.join(pluginRoot, 'node_modules', 'openclaw');
  if (existsSync(path.join(link, 'package.json'))) return path.join(link, 'package.json');
  return createRequire(path.join(pluginRoot, 'package.json')).resolve('openclaw/package.json');
}

const hostPath = hostOpenClawPath();
const hostVersion = createRequire(hostPath)(hostPath).version;
const report = checkPluginSdkSurface(pluginRoot, hostPath);

describe(`plugin SDK surface (host ${hostVersion})`, () => {
  it('ships a surface manifest that covers every SDK subpath used by src/', () => {
    expect(report.subpaths.length, report.manifestError ?? '').toBeGreaterThan(0);
  });

  it('ships a manifest that matches what src/ actually imports', () => {
    const scanned = extractSurface(pluginRoot);
    expect(report.manifestError).toBeUndefined();
    expect(scanned, 'run `node scripts/sdk-surface-check.js --write`').toEqual(report.manifest);
  });

  it('only imports subpaths the host OpenClaw exports', () => {
    expect(report.missingSubpaths, describeMissing('subpath', report)).toEqual([]);
  });

  it('only uses named exports the host OpenClaw still provides', () => {
    expect(report.missingSymbols, describeMissing('export', report)).toEqual([]);
  });
});

function describeMissing(kind, result) {
  if (!result.manifestError) return undefined;
  return `${kind}s cannot be checked: ${result.manifestError}`;
}
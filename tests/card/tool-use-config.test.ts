import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the session store before anything from the SDK is loaded: the
// resolver must read a throwaway state dir, never the live gateway database.
process.env.OPENCLAW_STATE_DIR = mkdtempSync(join(tmpdir(), "lark2-tool-use-"));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveToolUseDisplayConfig } = require("../../src/card/tool-use-config.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sessionStore = require("openclaw/plugin-sdk/session-store-runtime");

const CFG = {};

function resolve(params: Record<string, unknown> = {}) {
  return resolveToolUseDisplayConfig({
    cfg: CFG,
    feishuCfg: undefined,
    agentId: "main",
    sessionKey: "agent:main:feishu:dm:oc_no_entry",
    ...params,
  });
}

/** Write a real session entry through core's supported mutation API. */
function seedSession(sessionKey: string, entry: Record<string, unknown>) {
  return sessionStore.upsertSessionEntry({
    agentId: "main",
    sessionKey,
    entry: { sessionId: `sess-${sessionKey}`, updatedAt: Date.now(), ...entry },
  });
}

const FULL_KEY = "agent:main:feishu:dm:oc_verbose_full";
const OFF_KEY = "agent:main:feishu:dm:oc_verbose_off";
const BARE_KEY = "agent:main:feishu:dm:oc_verbose_bare";

beforeAll(async () => {
  await seedSession(FULL_KEY, { verboseLevel: "full" });
  await seedSession(OFF_KEY, { verboseLevel: "off" });
  // An entry that exists but carries no verbose level: the session must stop
  // the lookup (not fall through to another candidate key).
  await seedSession(BARE_KEY, {});
});

describe("tool-use display resolution", () => {
  it("returns a promise (the session read is async)", () => {
    expect(resolve()).toBeInstanceOf(Promise);
  });

  it("lets the inline override win without touching the session store", async () => {
    await expect(resolve({ body: "/verbose full", sessionKey: FULL_KEY })).resolves.toMatchObject({
      mode: "full",
      showToolUse: true,
      showToolResultDetails: true,
    });
    await expect(resolve({ body: "/verbose off", sessionKey: FULL_KEY })).resolves.toMatchObject({
      mode: "off",
      showToolUse: false,
      showToolResultDetails: false,
    });
  });

  it("uses the last inline override in the message", async () => {
    await expect(resolve({ body: "/verbose on\n/verbose full" })).resolves.toMatchObject({ mode: "full" });
  });

  it("reads the session-level override through the async reader", async () => {
    await expect(resolve({ sessionKey: FULL_KEY })).resolves.toMatchObject({
      mode: "full",
      showToolUse: true,
      showToolResultDetails: true,
    });
    await expect(resolve({ sessionKey: OFF_KEY })).resolves.toMatchObject({
      mode: "off",
      showToolUse: false,
    });
  });

  it("defaults to showing tool use when verbose was never configured", async () => {
    await expect(resolve()).resolves.toMatchObject({
      mode: "off",
      showToolUse: true,
      showToolResultDetails: false,
    });
  });

  it("stops at an entry that exists without a verbose level", async () => {
    const cfg = { agents: { defaults: { verboseDefault: "on" } } };
    await expect(resolve({ cfg, sessionKey: BARE_KEY })).resolves.toMatchObject({ mode: "on" });
  });

  it("falls back to the configured default when the session has no override", async () => {
    await expect(resolve({ cfg: { agents: { defaults: { verboseDefault: "on" } } } })).resolves.toMatchObject({
      mode: "on",
      showToolUse: true,
    });
  });

  it("uses the session override ahead of the configured default", async () => {
    const cfg = { agents: { defaults: { verboseDefault: "off" } } };
    await expect(resolve({ cfg, sessionKey: FULL_KEY })).resolves.toMatchObject({ mode: "full" });
  });

  it("honours the channel-level switch and path detail flag", async () => {
    const feishuCfg = { toolUseDisplay: { enabled: false, showFullPaths: true } };
    await expect(resolve({ feishuCfg, cfg: { agents: { defaults: { verboseDefault: "full" } } } })).resolves.toEqual({
      mode: "full",
      showToolUse: false,
      showToolResultDetails: true,
      showFullPaths: true,
    });
  });
});

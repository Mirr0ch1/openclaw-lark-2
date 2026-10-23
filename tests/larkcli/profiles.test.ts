import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const profiles = require("../../src/larkcli/profiles.js");

const FAKE = [
  "#!/bin/sh",
  'echo "$@" >> "$FAKE_LOG"',
  'case "$1" in',
  "  profile)",
  '    if [ "$2" = "list" ]; then cat "$FAKE_PROFILES"; exit 0; fi',
  "    exit 0;;",
  "  whoami)",
  "    cat \"$FAKE_WHOAMI\"; exit 0;;",
  "esac",
  'if [ "$1" = "--profile" ]; then',
  "  shift 2",
  '  if [ "$1" = "whoami" ]; then cat "$FAKE_WHOAMI"; exit 0; fi',
  "fi",
  'echo "{\"ok\":true}"',
].join("\n");

const realPath = process.env.PATH;
const realHome = process.env.HOME;
let dir: string;

function baseCfg(extra?: Record<string, unknown>) {
  return {
    channels: {
      feishu: {
        appId: "cli_top",
        appSecret: "sec_top",
        accounts: {
          plaud: { appId: "cli_plaud", appSecret: "sec_plaud" },
          hdwriting: { appId: "cli_hdw", appSecret: "sec_hdw" },
        },
        ...(extra || {}),
      },
    },
  };
}

function setProfiles(json: unknown) {
  writeFileSync(process.env.FAKE_PROFILES as string, JSON.stringify(json));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lark2-profiles-"));
  mkdirSync(join(dir, "bin"));
  const bin = join(dir, "bin", "lark-cli");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  writeFileSync(join(dir, "log"), "");
  writeFileSync(join(dir, "whoami.json"), JSON.stringify({ available: true, tokenStatus: "ready", identity: "bot" }));
  writeFileSync(join(dir, "profiles.json"), "[]");
  process.env.PATH = join(dir, "bin") + ":" + realPath;
  process.env.HOME = dir;
  process.env.FAKE_LOG = join(dir, "log");
  process.env.FAKE_PROFILES = join(dir, "profiles.json");
  process.env.FAKE_WHOAMI = join(dir, "whoami.json");
});

afterEach(() => {
  process.env.PATH = realPath;
  process.env.HOME = realHome;
  delete process.env.FAKE_LOG;
  delete process.env.FAKE_PROFILES;
  delete process.env.FAKE_WHOAMI;
  rmSync(dir, { recursive: true, force: true });
});

describe("profileNameFor", () => {
  it("uses the accountId verbatim (no translation table)", () => {
    expect(profiles.profileNameFor("plaud")).toBe("plaud");
    expect(profiles.profileNameFor("HDWriting")).toBe("hdwriting");
  });

  it("falls back to the default account and sanitises unsafe characters", () => {
    expect(profiles.profileNameFor("")).toBe("default");
    expect(profiles.profileNameFor(undefined)).toBe("default");
    expect(profiles.profileNameFor("A b/C")).toBe("a-b-c");
  });
});

describe("isLarkCliEnabled", () => {
  it("honours an explicit off switch", () => {
    expect(profiles.isLarkCliEnabled(baseCfg({ larkCli: { enabled: false } }), "plaud")).toBe(false);
  });

  it("honours an explicit on switch", () => {
    expect(profiles.isLarkCliEnabled(baseCfg({ larkCli: { enabled: true } }), "plaud")).toBe(true);
  });

  it("follows binary discovery in auto mode", () => {
    expect(profiles.isLarkCliEnabled(baseCfg(), "plaud")).toBe(true);
    process.env.PATH = "/nonexistent";
    process.env.HOME = "/nonexistent";
    expect(profiles.isLarkCliEnabled(baseCfg(), "plaud")).toBe(false);
  });
});

describe("buildIdentityRules", () => {
  it("is silent when delegation is disabled", () => {
    expect(profiles.buildIdentityRules(baseCfg({ larkCli: { enabled: false } }), "plaud")).toEqual([]);
  });

  it("is silent for an unconfigured account (no credentials, no noise)", () => {
    expect(profiles.buildIdentityRules({ channels: { feishu: {} } }, undefined)).toEqual([]);
    expect(profiles.buildIdentityRules({}, undefined)).toEqual([]);
  });

  it("names the current profile, the wrapper, and the other accounts", () => {
    const rules = profiles.buildIdentityRules(baseCfg(), "plaud");
    const text = rules.join("\n");
    expect(text).toContain("account=plaud profile=plaud");
    expect(text).toContain(profiles.wrapperPath());
    expect(text).toContain("--profile plaud");
    expect(text).toContain("hdwriting");
    expect(text).toContain("auth login --no-wait");
  });
});

describe("listProfiles", () => {
  it("parses the JSON array emitted by the CLI", () => {
    setProfiles([{ name: "plaud", appId: "cli_plaud", active: false }]);
    const res = profiles.listProfiles(baseCfg());
    expect(res.ok).toBe(true);
    expect(res.profiles[0]).toMatchObject({ name: "plaud", appId: "cli_plaud", active: false });
  });
});

describe("provisionProfiles", () => {
  it("creates a profile per account, secrets over stdin (never argv)", () => {
    setProfiles([]);
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.ok).toBe(true);
    expect(res.created.sort()).toEqual(["default", "hdwriting", "plaud"]);
    const log = readFileSync(process.env.FAKE_LOG as string, "utf8");
    expect(log).toContain("profile add --name plaud --app-id cli_plaud --app-secret-stdin");
    expect(log).not.toContain("sec_plaud");
  });

  it("is idempotent: matching appIds are skipped", () => {
    setProfiles([
      { name: "plaud", appId: "cli_plaud" },
      { name: "hdwriting", appId: "cli_hdw" },
      { name: "default", appId: "cli_top" },
    ]);
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.ok).toBe(true);
    expect(res.skipped.sort()).toEqual(["default", "hdwriting", "plaud"]);
    // Only the read-only discovery call is allowed; nothing may be added.
    expect(readFileSync(process.env.FAKE_LOG as string, "utf8")).not.toContain("profile add");
  });

  it("refuses to repoint a profile at a different appId without force", () => {
    setProfiles([{ name: "plaud", appId: "cli_other" }]);
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.ok).toBe(false);
    expect(res.failed[0].accountId).toBe("plaud");
    expect(res.failed[0].error).toContain("force");
  });
});

describe("healthCheck", () => {
  it("reports ready accounts", () => {
    setProfiles([{ name: "plaud", appId: "cli_plaud" }]);
    const rows = profiles.healthCheck(baseCfg());
    const plaud = rows.find((r: any) => r.accountId === "plaud");
    expect(plaud.ok).toBe(true);
    expect(plaud.appIdMatch).toBe(true);
    expect(plaud.identity).toBe("bot");
  });

  it("flags a missing profile", () => {
    setProfiles([]);
    const rows = profiles.healthCheck(baseCfg());
    expect(rows.every((r: any) => r.ok === false)).toBe(true);
    expect(rows[0].error).toContain("not provisioned");
  });

  it("flags an appId drift", () => {
    setProfiles([{ name: "plaud", appId: "cli_other" }]);
    const rows = profiles.healthCheck(baseCfg());
    const plaud = rows.find((r: any) => r.accountId === "plaud");
    expect(plaud.ok).toBe(false);
    expect(plaud.error).toContain("!=");
  });
});

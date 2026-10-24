import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const profiles = require("../../src/larkcli/profiles.js");

const FAKE = [
  "#!/bin/sh",
  'echo "env:OPENCLAW_HOME=$OPENCLAW_HOME" >> "$FAKE_LOG"',
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
  process.env.OPENCLAW_HOME = join(dir, ".openclaw");
});

afterEach(() => {
  process.env.PATH = realPath;
  process.env.HOME = realHome;
  delete process.env.FAKE_LOG;
  delete process.env.FAKE_PROFILES;
  delete process.env.FAKE_WHOAMI;
  delete process.env.OPENCLAW_HOME;
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

  it("defaults to a one-line minimal block", () => {
    const rules = profiles.buildIdentityRules(baseCfg(), "plaud");
    const text = rules.join("\n");
    expect(rules).toHaveLength(1);
    expect(text.length).toBeLessThan(160);
    expect(text).toContain("profile for this chat: plaud");
    expect(text).toContain(profiles.wrapperPath());
    // Nothing that the wrapper already enforces, and nothing for rare flows.
    expect(text).not.toContain("Never profile use");
    expect(text).not.toContain("auth login --no-wait");
  });

  it("compact adds the other accounts and the never-run list", () => {
    const text = profiles.buildIdentityRules(baseCfg({ larkCli: { prompt: "compact" } }), "plaud").join("\n");
    expect(text).toContain("Other accounts");
    expect(text).toContain("Never profile use");
    expect(text.length).toBeLessThan(450);
  });

  it("can be switched off entirely", () => {
    expect(profiles.buildIdentityRules(baseCfg({ larkCli: { prompt: "off" } }), "plaud")).toEqual([]);
  });

  it("full mode names the profile, the wrapper, the other accounts and the CLI shape", () => {
    const rules = profiles.buildIdentityRules(baseCfg({ larkCli: { prompt: "full" } }), "plaud");
    const text = rules.join("\n");
    expect(text).toContain("account=plaud profile=plaud");
    expect(text).toContain(profiles.wrapperPath());
    expect(text).toContain("--profile plaud");
    expect(text).toContain("hdwriting");
    expect(text).toContain("auth login --no-wait");
    // Root commands take no domain — the observed failure was "auth whoami".
    expect(text).toContain("root commands take NO domain");
    expect(text).toContain("never \"auth whoami\"");
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

describe("store pinning and name resolution", () => {
  it("pins OPENCLAW_HOME so plugin-side calls read the bound store", () => {
    // The fake CLI records the env it saw.
    setProfiles([]);
    profiles.provisionProfiles(baseCfg());
    const home = join(dir, ".openclaw");
    expect(profiles.openclawHome()).toBe(home);
    // The CLI itself must have seen the pinned value, not just our helper.
    expect(readFileSync(process.env.FAKE_LOG as string, "utf8")).toContain("env:OPENCLAW_HOME=" + home);
  });

  it("adopts an existing profile bound under its appId instead of duplicating it", () => {
    // lark-cli rejects two profiles for one appId, so the plugin must adopt.
    setProfiles([{ name: "cli_top", appId: "cli_top" }]);
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.ok).toBe(true);
    expect(res.adopted.join()).toContain("default -> cli_top");
    expect(readFileSync(process.env.FAKE_LOG as string, "utf8")).not.toContain("--name default");
    // ...and the resolved name is what the prompt advertises.
    expect(profiles.resolveProfileName(baseCfg(), "default")).toBe("cli_top");
  });

  it("mirrors the wrapper into $OPENCLAW_HOME/bin", () => {
    const target = profiles.ensureStableWrapper();
    expect(target).toBe(join(dir, ".openclaw", "bin", "feishu-lark"));
    expect(existsSync(target)).toBe(true);
    expect(profiles.wrapperPath()).toBe(target);
  });
});

describe("credential repair", () => {
  it("re-adds credentials when a surviving profile lost its secret", () => {
    // A profile row can outlive its credentials (removing the same appId from
    // the other store clears the shared secret). whoami is the only probe, and
    // repair is safe because not_configured implies no user token to lose.
    setProfiles([{ name: "plaud", appId: "cli_plaud" }]);
    writeFileSync(process.env.FAKE_WHOAMI as string, JSON.stringify({ available: false, tokenStatus: "not_configured", identity: "bot" }));
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.repaired).toContain("plaud");
    const log = readFileSync(process.env.FAKE_LOG as string, "utf8");
    expect(log).toContain("profile remove plaud");
    expect(log).toContain("profile add --name plaud --app-id cli_plaud");
  });

  it("never touches a healthy profile (no remove, no re-add)", () => {
    setProfiles([{ name: "plaud", appId: "cli_plaud" }, { name: "hdwriting", appId: "cli_hdw" }, { name: "default", appId: "cli_top" }]);
    const res = profiles.provisionProfiles(baseCfg());
    expect(res.skipped.sort()).toEqual(["default", "hdwriting", "plaud"]);
    expect(readFileSync(process.env.FAKE_LOG as string, "utf8")).not.toContain("profile remove");
  });
});

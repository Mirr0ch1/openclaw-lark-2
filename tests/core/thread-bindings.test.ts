import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The binding store is core-owned state. Point it at a throwaway state dir
// before anything from the SDK is loaded, so the suite never competes with a
// running gateway for the live database.
process.env.OPENCLAW_STATE_DIR = mkdtempSync(join(tmpdir(), "lark2-bindings-"));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tb = require("../../src/core/thread-bindings.js");

const CFG = { channels: { feishu: { appId: "cli_x", appSecret: "sec_x" } } };

/**
 * Cores released before 2026.10.10 only expose the synchronous manager methods
 * (deprecated, removed in the first January 2027 stable release). Newer cores
 * expose the V2 manager whose methods carry an `Async` suffix. The tests drive
 * whichever surface the installed core provides.
 */
function bindingApi(manager: Record<string, any>) {
  const call = (base: string) => {
    const name = typeof manager[`${base}Async`] === "function" ? `${base}Async` : base;
    return async (...args: any[]) => manager[name](...args);
  };
  return {
    bindConversation: call("bindConversation"),
    getByConversationId: call("getByConversationId"),
    listBySessionKey: call("listBySessionKey"),
    touchConversation: call("touchConversation"),
    unbindConversation: call("unbindConversation"),
    unbindBySessionKey: call("unbindBySessionKey"),
  };
}

function managerFor(accountId: string) {
  const manager = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId });
  if (!manager) {
    throw new Error("thread binding manager unavailable on this core");
  }
  return { manager, api: bindingApi(manager) };
}

afterEach(() => {
  tb.resetFeishuThreadBindingsForTests();
});

describe("thread-bindings target-kind mapping", () => {
  it("stores the non-subagent kind as acp", () => {
    expect(tb.toStoredTargetKind("subagent")).toBe("subagent");
    expect(tb.toStoredTargetKind("session")).toBe("acp");
  });

  it("maps back to core's kinds", () => {
    expect(tb.toSessionBindingTargetKind("subagent")).toBe("subagent");
    expect(tb.toSessionBindingTargetKind("acp")).toBe("session");
  });
});

describe("thread-binding manager (against the installed core)", () => {
  it("is supported on a current core", () => {
    expect(tb.isFeishuThreadBindingsSupported()).toBe(true);
  });

  it("creates one manager per account and reuses it", () => {
    const a = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    const b = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(typeof a.stop).toBe("function");
    const api = bindingApi(a);
    expect(typeof api.getByConversationId).toBe("function");
    expect(tb.getFeishuThreadBindingManager("default")).toBe(a);
  });

  it("binds a conversation to a session and reads it back", async () => {
    const { api } = managerFor("default");
    const sessionKey = "sess:bind:abc";
    const record = await api.bindConversation({
      conversationId: "oc_bind:topic:t1",
      targetKind: "subagent",
      targetSessionKey: sessionKey,
      metadata: {},
    });
    expect(record).toMatchObject({
      accountId: "default",
      conversationId: "oc_bind:topic:t1",
      targetKind: "subagent",
      targetSessionKey: sessionKey,
    });
    expect(await api.getByConversationId("oc_bind:topic:t1")).toMatchObject({ targetSessionKey: sessionKey });
    expect(await api.listBySessionKey(sessionKey)).toHaveLength(1);
    expect(await api.getByConversationId("oc_other")).toBeUndefined();
  });

  it("keeps accounts isolated", async () => {
    const a = managerFor("acct-a").api;
    const b = managerFor("acct-b").api;
    await a.bindConversation({ conversationId: "oc_iso", targetKind: "subagent", targetSessionKey: "sess:iso:1", metadata: {} });
    expect(await b.getByConversationId("oc_iso")).toBeUndefined();
    expect(await b.listBySessionKey("sess:iso:1")).toHaveLength(0);
  });

  it("rejects an empty conversation or session", async () => {
    const { api } = managerFor("default");
    expect(await api.bindConversation({ conversationId: "  ", targetKind: "subagent", targetSessionKey: "sess:empty:1", metadata: {} })).toBeNull();
    expect(await api.bindConversation({ conversationId: "oc_empty", targetKind: "subagent", targetSessionKey: "  ", metadata: {} })).toBeNull();
  });

  it("unbinds by conversation and by session", async () => {
    const { api } = managerFor("default");
    const sessionKey = "sess:unbind:1";
    await api.bindConversation({ conversationId: "oc_un_a", targetKind: "subagent", targetSessionKey: sessionKey, metadata: {} });
    await api.bindConversation({ conversationId: "oc_un_b", targetKind: "subagent", targetSessionKey: sessionKey, metadata: {} });
    expect(await api.listBySessionKey(sessionKey)).toHaveLength(2);

    expect(await api.unbindConversation("oc_un_a")).not.toBeNull();
    expect(await api.getByConversationId("oc_un_a")).toBeUndefined();

    expect(await api.unbindBySessionKey(sessionKey)).toHaveLength(1);
    expect(await api.listBySessionKey(sessionKey)).toHaveLength(0);
  });

  it("stops a manager and forgets it (idempotent)", () => {
    const { manager } = managerFor("default");
    expect(manager).not.toBeNull();
    tb.stopFeishuThreadBindingManager("default");
    expect(tb.getFeishuThreadBindingManager("default")).toBeNull();
    // A second stop must not throw.
    expect(() => tb.stopFeishuThreadBindingManager("default")).not.toThrow();
  });

  it("touching an unknown conversation is a no-op", async () => {
    const { api } = managerFor("default");
    expect(await api.touchConversation("oc_missing")).toBeNull();
  });

  it("stores a session binding as acp through the manager", async () => {
    const { api } = managerFor("default");
    const record = await api.bindConversation({
      conversationId: "oc_kind",
      targetKind: "session",
      targetSessionKey: "sess:kind:1",
      metadata: {},
    });
    expect(record).toMatchObject({ targetKind: "acp" });
    expect(await api.getByConversationId("oc_kind")).toMatchObject({ targetKind: "acp" });
  });

  it("keeps bindings across a manager restart (core bindings are durable)", async () => {
    const sessionKey = "sess:durable:1";
    const first = managerFor("default");
    await first.api.bindConversation({
      conversationId: "oc_durable",
      targetKind: "subagent",
      targetSessionKey: sessionKey,
      metadata: {},
    });
    tb.stopFeishuThreadBindingManager("default");
    const second = managerFor("default");
    expect(second.manager).not.toBe(first.manager);
    expect(await second.api.getByConversationId("oc_durable")).toMatchObject({ targetSessionKey: sessionKey });
  });
});

describe("feature detection", () => {
  /** Run `src/core/thread-bindings.js` behind a stubbed SDK subpath. */
  function probeWithStub(stub: string) {
    const modulePath = join(process.cwd(), "src/core/thread-bindings.js");
    const script = `
      const Module = require("node:module");
      const orig = Module._load;
      Module._load = function (request) {
        if (request === "openclaw/plugin-sdk/thread-bindings-runtime") ${stub};
        return orig.apply(this, arguments);
      };
      const tb = require(${JSON.stringify(modulePath)});
      const created = tb.createFeishuThreadBindingManager({ cfg: {}, accountId: "default" });
      process.stdout.write(JSON.stringify({
        supported: tb.isFeishuThreadBindingsSupported(),
        created: created === null,
        got: tb.getFeishuThreadBindingManager("default") === null,
      }));
    `;
    return JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }));
  }

  it("degrades to null when the host lacks the subpath", () => {
    // A core older than the module layout throws at require() time.
    expect(probeWithStub('throw new Error("subpath missing")')).toEqual({ supported: false, created: true, got: true });
  });

  it("degrades to null when the subpath exports no manager factory", () => {
    expect(probeWithStub("return {}")).toEqual({ supported: false, created: true, got: true });
  });
});

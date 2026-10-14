import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const tb = require("../../src/core/thread-bindings.js");

const CFG = { channels: { feishu: { appId: "cli_x", appSecret: "sec_x" } } };

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
    expect(typeof a.getByConversationId).toBe("function");
    expect(tb.getFeishuThreadBindingManager("default")).toBe(a);
  });

  it("binds a conversation to a session and reads it back", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    const sessionKey = "sess:bind:abc";
    const record = m.bindConversation({
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
    expect(m.getByConversationId("oc_bind:topic:t1")).toMatchObject({ targetSessionKey: sessionKey });
    expect(m.listBySessionKey(sessionKey)).toHaveLength(1);
    expect(m.getByConversationId("oc_other")).toBeUndefined();
  });

  it("keeps accounts isolated", () => {
    const a = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "acct-a" });
    const b = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "acct-b" });
    a.bindConversation({ conversationId: "oc_iso", targetKind: "subagent", targetSessionKey: "sess:iso:1", metadata: {} });
    expect(b.getByConversationId("oc_iso")).toBeUndefined();
    expect(b.listBySessionKey("sess:iso:1")).toHaveLength(0);
  });

  it("rejects an empty conversation or session", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    expect(m.bindConversation({ conversationId: "  ", targetKind: "subagent", targetSessionKey: "sess:empty:1", metadata: {} })).toBeNull();
    expect(m.bindConversation({ conversationId: "oc_empty", targetKind: "subagent", targetSessionKey: "  ", metadata: {} })).toBeNull();
  });

  it("unbinds by conversation and by session", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    const sessionKey = "sess:unbind:1";
    m.bindConversation({ conversationId: "oc_un_a", targetKind: "subagent", targetSessionKey: sessionKey, metadata: {} });
    m.bindConversation({ conversationId: "oc_un_b", targetKind: "subagent", targetSessionKey: sessionKey, metadata: {} });
    expect(m.listBySessionKey(sessionKey)).toHaveLength(2);

    expect(m.unbindConversation("oc_un_a")).not.toBeNull();
    expect(m.getByConversationId("oc_un_a")).toBeUndefined();

    expect(m.unbindBySessionKey(sessionKey)).toHaveLength(1);
    expect(m.listBySessionKey(sessionKey)).toHaveLength(0);
  });

  it("stops a manager and forgets it (idempotent)", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    expect(m).not.toBeNull();
    tb.stopFeishuThreadBindingManager("default");
    expect(tb.getFeishuThreadBindingManager("default")).toBeNull();
    // A second stop must not throw.
    expect(() => tb.stopFeishuThreadBindingManager("default")).not.toThrow();
  });

  it("touching an unknown conversation is a no-op", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    expect(m.touchConversation("oc_missing")).toBeNull();
  });

  it("stores a `session` binding as `acp` through the manager", () => {
    const m = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    const record = m.bindConversation({
      conversationId: "oc_kind",
      targetKind: "session",
      targetSessionKey: "sess:kind:1",
      metadata: {},
    });
    expect(record).toMatchObject({ targetKind: "acp" });
    expect(m.getByConversationId("oc_kind")).toMatchObject({ targetKind: "acp" });
  });

  it("keeps bindings across a manager restart (core bindings are durable)", () => {
    const sessionKey = "sess:durable:1";
    const first = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    first.bindConversation({
      conversationId: "oc_durable",
      targetKind: "subagent",
      targetSessionKey: sessionKey,
      metadata: {},
    });
    tb.stopFeishuThreadBindingManager("default");
    const second = tb.createFeishuThreadBindingManager({ cfg: CFG, accountId: "default" });
    expect(second).not.toBe(first);
    expect(second.getByConversationId("oc_durable")).toMatchObject({ targetSessionKey: sessionKey });
  });
});

describe("feature detection", () => {
  it("degrades to null when the host lacks the manager", () => {
    // Exercise the guard in a child process that makes the SDK subpath throw,
    // which is exactly what an older core does at require() time.
    const modulePath = join(process.cwd(), "src/core/thread-bindings.js");
    const script = `
      const Module = require("node:module");
      const orig = Module._load;
      Module._load = function (request) {
        if (request === "openclaw/plugin-sdk/thread-bindings-runtime") throw new Error("subpath missing");
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
    const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual({ supported: false, created: true, got: true });
  });
});

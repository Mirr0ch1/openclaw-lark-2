import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MessageDedup, isMessageExpired } = require("../../src/messaging/inbound/dedup.js");

/**
 * In-memory fake of the host SDK claimable-dedupe guard. Exercises the
 * claim/commit/release path deterministically without a real SQLite database.
 */
function makeFakeGuard() {
  const seen = new Map(); // `${namespace}\u0000${key}` -> seenAt
  const inflight = new Set();
  const calls = { claim: 0, commit: 0, release: 0, warmup: 0, clearMemory: 0 };
  const nk = (ns: string | undefined, key: string) => `${ns || "global"}\u0000${key}`;
  return {
    calls,
    seen,
    guard: {
      async claim(key: string, opts: { namespace?: string } = {}) {
        calls.claim++;
        const k = nk(opts.namespace, key);
        if (inflight.has(k)) return { kind: "inflight", pending: Promise.resolve(false) };
        if (seen.has(k)) return { kind: "duplicate" };
        inflight.add(k);
        return { kind: "claimed" };
      },
      async commit(key: string, opts: { namespace?: string } = {}) {
        calls.commit++;
        const k = nk(opts.namespace, key);
        inflight.delete(k);
        seen.set(k, Date.now());
        return true;
      },
      release(key: string, opts: { namespace?: string } = {}) {
        calls.release++;
        inflight.delete(nk(opts.namespace, key));
      },
      async hasRecent(key: string, opts: { namespace?: string } = {}) {
        return seen.has(nk(opts.namespace, key));
      },
      async forget(key: string, opts: { namespace?: string } = {}) {
        const k = nk(opts.namespace, key);
        inflight.delete(k);
        return seen.delete(k);
      },
      async warmup() {
        calls.warmup++;
        return 7;
      },
      clearMemory() {
        calls.clearMemory++;
        seen.clear();
        inflight.clear();
      },
      memorySize() {
        return seen.size;
      },
    },
  };
}

describe("MessageDedup — claim/commit (C2)", () => {
  it("claims a fresh key, then reports it as a duplicate after commit", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(true);
    await dedup.commit("om_1", "acctA");
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(false);
    dedup.dispose();
  });

  it("reports an uncommitted key as not-claimed (in-flight)", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(true);
    // Still in-flight (not committed) → a second claim does not own it.
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(false);
    dedup.dispose();
  });

  it("release allows the key to be claimed again (retry path)", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    await dedup.claim("om_1", "acctA");
    dedup.release("om_1", "acctA");
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(true);
    dedup.dispose();
  });

  it("scopes keys per account namespace", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    await dedup.tryRecord("om_1", "acctA");
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(false);
    // Same id under a different account is a distinct key.
    expect(await dedup.tryRecord("om_1", "acctB")).toBe(true);
    dedup.dispose();
  });

  it("defaults to the `global` namespace when no scope is given", async () => {
    const { guard, seen } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    await dedup.tryRecord("om_1");
    expect([...seen.keys()][0].startsWith("global\u0000")).toBe(true);
    dedup.dispose();
  });

  it("tryRecord is claim+commit (new then duplicate)", async () => {
    const { guard, calls } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(true);
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(false);
    expect(calls.claim).toBe(2);
    expect(calls.commit).toBe(1);
    dedup.dispose();
  });

  it("forget removes a recorded key so it is new again", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    await dedup.tryRecord("om_1", "acctA");
    expect(await dedup.hasRecent("om_1", "acctA")).toBe(true);
    await dedup.forget("om_1", "acctA");
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(true);
    dedup.dispose();
  });

  it("warmup loads persisted entries and reports the count", async () => {
    const { guard, calls } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect(await dedup.warmup("acctA")).toBe(7);
    expect(calls.warmup).toBe(1);
    dedup.dispose();
  });

  it("exposes the guard's memory size as `size`", async () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect(dedup.size).toBe(0);
    await dedup.tryRecord("om_1", "acctA");
    expect(dedup.size).toBe(1);
    dedup.dispose();
  });

  it("clearMemory on dispose reaches the guard", async () => {
    const { guard, calls } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    dedup.dispose();
    expect(calls.clearMemory).toBe(1);
  });
});

describe("MessageDedup — persistent flag (C2)", () => {
  it("reports persistent=true for an injected guard by default", () => {
    const { guard } = makeFakeGuard();
    const dedup = new MessageDedup({ guard });
    expect(dedup.persistent).toBe(true);
    dedup.dispose();
  });

  it("reports persistent=false when persistence is disabled", () => {
    const dedup = new MessageDedup({ persistent: false });
    expect(dedup.persistent).toBe(false);
    dedup.dispose();
  });
});

describe("MessageDedup — memory-only fallback (C2)", () => {
  it("keeps claim/commit semantics when persistence is disabled", async () => {
    const dedup = new MessageDedup({ persistent: false, ttlMs: 60_000, maxEntries: 3 });
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(true);
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(false);
    expect(dedup.size).toBe(1);
    dedup.dispose();
  });

  it("release in memory-only mode allows a re-claim", async () => {
    const dedup = new MessageDedup({ persistent: false, ttlMs: 60_000 });
    await dedup.claim("om_1", "acctA");
    dedup.release("om_1", "acctA");
    expect((await dedup.claim("om_1", "acctA")).claimed).toBe(true);
    dedup.dispose();
  });

  it("evicts the oldest entry when the capacity is exceeded", async () => {
    const dedup = new MessageDedup({ persistent: false, ttlMs: 60_000, maxEntries: 2 });
    await dedup.tryRecord("a", "s");
    await dedup.tryRecord("b", "s");
    await dedup.tryRecord("c", "s"); // evicts 'a'
    expect(dedup.size).toBe(2);
    expect(await dedup.tryRecord("a", "s")).toBe(true);
    dedup.dispose();
  });

  it("expires an entry past its TTL", async () => {
    const dedup = new MessageDedup({ persistent: false, ttlMs: -1 });
    await dedup.tryRecord("om_1", "acctA");
    // ttl -1 means every prior entry is already expired → new again.
    expect(await dedup.tryRecord("om_1", "acctA")).toBe(true);
    dedup.dispose();
  });

  it("warmup is a no-op (returns 0) in memory-only mode", async () => {
    const dedup = new MessageDedup({ persistent: false });
    expect(await dedup.warmup("acctA")).toBe(0);
    dedup.dispose();
  });
});

describe("isMessageExpired", () => {
  it("is false for a missing or non-numeric create_time", () => {
    expect(isMessageExpired(undefined)).toBe(false);
    expect(isMessageExpired("not-a-number")).toBe(false);
  });

  it("is true for a timestamp older than the expiry window", () => {
    const old = String(Date.now() - 60 * 60 * 1000); // 1h ago
    expect(isMessageExpired(old, 30 * 60 * 1000)).toBe(true);
  });

  it("is false for a recent timestamp", () => {
    expect(isMessageExpired(String(Date.now()), 30 * 60 * 1000)).toBe(false);
  });
});

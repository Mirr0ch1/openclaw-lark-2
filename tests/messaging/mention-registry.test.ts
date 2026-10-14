import { describe, it, expect, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  recordSender,
  recordMention,
  lookupByName,
  resetMentionRegistry,
  purgeStaleEntries,
} = require("../../src/messaging/inbound/mention-registry.js");

beforeEach(() => {
  resetMentionRegistry();
});

describe("mention-registry — lookups (C3)", () => {
  it("resolves a recorded sender by name, case-insensitively", () => {
    recordSender("oc_1", "ou_alice", "Alice");
    expect(lookupByName("oc_1", "alice")).toBe("ou_alice");
    expect(lookupByName("oc_1", "  ALICE ")).toBe("ou_alice");
  });

  it("resolves a recorded @-mention target", () => {
    recordMention("oc_1", "ou_bob", "Bob");
    expect(lookupByName("oc_1", "Bob")).toBe("ou_bob");
  });

  it("isolates names per chat", () => {
    recordSender("oc_1", "ou_alice", "Alice");
    expect(lookupByName("oc_2", "Alice")).toBeUndefined();
  });

  it("returns undefined for an unknown name", () => {
    expect(lookupByName("oc_1", "Nobody")).toBeUndefined();
  });

  it("ignores empty/blank inputs", () => {
    recordSender("", "ou_a", "A");
    recordSender("oc_1", "", "A");
    recordSender("oc_1", "ou_a", "   ");
    expect(lookupByName("oc_1", "A")).toBeUndefined();
  });

  it("evicts an entry past its TTL on read", () => {
    recordSender("oc_1", "ou_alice", "Alice");
    expect(lookupByName("oc_1", "Alice", { ttlMs: -1 })).toBeUndefined();
    // Evicted → a subsequent default-TTL lookup is also a miss.
    expect(lookupByName("oc_1", "Alice")).toBeUndefined();
  });
});

describe("mention-registry — bounded growth (C3)", () => {
  it("caps the number of distinct names per chat at 500", () => {
    for (let i = 0; i < 600; i++) {
      recordSender("oc_1", `ou_${i}`, `name_${i}`);
    }
    // The oldest names (0..99) were pruned; recent ones survive.
    expect(lookupByName("oc_1", "name_599")).toBe("ou_599");
    expect(lookupByName("oc_1", "name_0")).toBeUndefined();
    // Still bounded: exactly the cap's worth of names remain.
    let live = 0;
    for (let i = 0; i < 600; i++) {
      if (lookupByName("oc_1", `name_${i}`) !== undefined) live++;
    }
    expect(live).toBe(500);
  });

  it("caps the number of tracked chats at 500", () => {
    for (let i = 0; i < 600; i++) {
      recordSender(`oc_${i}`, `ou_${i}`, "Same");
    }
    // The most recently seen chat survives; the oldest was pruned.
    expect(lookupByName("oc_599", "Same")).toBe("ou_599");
    expect(lookupByName("oc_0", "Same")).toBeUndefined();
  });

  it("keeps an actively-updated name alive (LRU refresh on write)", () => {
    // Fill the chat, then keep re-writing the first name.
    for (let i = 0; i < 500; i++) {
      recordSender("oc_1", `ou_${i}`, `name_${i}`);
    }
    // Refresh name_0 so it moves to the tail, then add a new name to force a prune.
    recordSender("oc_1", "ou_0", "name_0");
    recordSender("oc_1", "ou_new", "name_new");
    // name_0 survived the prune because it was refreshed; name_1 did not.
    expect(lookupByName("oc_1", "name_0")).toBe("ou_0");
    expect(lookupByName("oc_1", "name_1")).toBeUndefined();
  });

  it("purgeStaleEntries drops expired entries and empties chats", () => {
    recordSender("oc_1", "ou_alice", "Alice");
    purgeStaleEntries(-1); // everything is older than the cutoff
    expect(lookupByName("oc_1", "Alice")).toBeUndefined();
  });
});

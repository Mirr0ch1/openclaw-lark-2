import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildFlushIngressLifecycle } = require("../../src/channel/ingress-lifecycle.js");

function makeLifecycle() {
  const calls = { adopted: 0, abandoned: 0, finalizing: 0 };
  return {
    calls,
    lifecycle: {
      abortSignal: new AbortController().signal,
      onAdopted: async () => {
        calls.adopted++;
      },
      onDeferred: () => {},
      onAdoptionFinalizing: () => {
        calls.finalizing++;
      },
      onAbandoned: async () => {
        calls.abandoned++;
      },
    },
  };
}

function makeReplayClaim() {
  const calls = { commit: 0, release: 0 };
  return {
    calls,
    claim: {
      keys: ["k1"],
      commit: async () => {
        calls.commit++;
        return true;
      },
      release: () => {
        calls.release++;
      },
    },
  };
}

describe("buildFlushIngressLifecycle", () => {
  it("returns an undefined lifecycle when no source is durable", async () => {
    const { lifecycle, settle } = buildFlushIngressLifecycle([{}, {}]);
    expect(lifecycle).toBeUndefined();
    await expect(settle()).resolves.toBeUndefined();
  });

  it("adopts the transport lifecycle and commits the replay claim on adoption", async () => {
    const { lifecycle: src, calls } = makeLifecycle();
    const { claim, calls: claimCalls } = makeReplayClaim();
    const { lifecycle } = buildFlushIngressLifecycle([{ lifecycle: src, replayClaim: claim }]);
    expect(lifecycle).toBeDefined();
    await lifecycle.onAdopted();
    expect(calls.adopted).toBe(1);
    expect(claimCalls.commit).toBe(1);
  });

  it("abandons the transport lifecycle and releases the replay claim", async () => {
    const { lifecycle: src, calls } = makeLifecycle();
    const { claim, calls: claimCalls } = makeReplayClaim();
    const { lifecycle } = buildFlushIngressLifecycle([{ lifecycle: src, replayClaim: claim }]);
    await lifecycle.onAbandoned();
    expect(calls.abandoned).toBe(1);
    expect(claimCalls.release).toBe(1);
  });

  it("settle() releases the replay claim and adopts the transport lifecycle", async () => {
    const { lifecycle: src, calls } = makeLifecycle();
    const { claim, calls: claimCalls } = makeReplayClaim();
    const { settle } = buildFlushIngressLifecycle([{ lifecycle: src, replayClaim: claim }]);
    await settle();
    expect(claimCalls.release).toBe(1);
    expect(calls.adopted).toBe(1);
  });

  it("is idempotent: adopting then abandoning does not abandon", async () => {
    const { lifecycle: src, calls } = makeLifecycle();
    const { lifecycle } = buildFlushIngressLifecycle([{ lifecycle: src }]);
    await lifecycle.onAdopted();
    await lifecycle.onAbandoned();
    expect(calls.adopted).toBe(1);
    expect(calls.abandoned).toBe(0);
  });

  it("fans in multiple durable sources", async () => {
    const a = makeLifecycle();
    const b = makeLifecycle();
    const { lifecycle } = buildFlushIngressLifecycle([
      { lifecycle: a.lifecycle },
      { lifecycle: b.lifecycle },
    ]);
    await lifecycle.onAdopted();
    expect(a.calls.adopted).toBe(1);
    expect(b.calls.adopted).toBe(1);
  });
});

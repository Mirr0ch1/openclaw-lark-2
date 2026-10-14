import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveInteractiveDedupeId } = require("../../src/channel/interactive-dispatch.js");

/**
 * Core's dispatchPluginInteractiveHandler claims a `dedupeId` and commits a
 * 5-minute TTL entry on match. Regression for batch B / B4: keying dedupe on
 * the button/action (a stable string) silently swallowed a second, deliberate
 * click on the same button inside the TTL window. The key must identify the
 * *event* (event_id, falling back to token), and be omitted entirely when
 * neither is present so core skips dedupe rather than collapsing clicks.
 *
 * Mirrors the isolation strategy of tests/messaging/dedupe-key.test.ts: the
 * derivation lives in a pure exported helper so it can be tested directly
 * (the SDK dispatch namespace is immutable under vitest, so it cannot be
 * spied on from the integration path).
 */

describe("resolveInteractiveDedupeId (B4)", () => {
  it("keys on the callback event id when present", () => {
    expect(resolveInteractiveDedupeId("default", "ev_1", undefined)).toBe(
      "feishu:default:ev_1",
    );
  });

  it("prefers the event id over the token", () => {
    expect(resolveInteractiveDedupeId("default", "ev_1", "tk_1")).toBe(
      "feishu:default:ev_1",
    );
  });

  it("falls back to the token when event_id is absent", () => {
    expect(resolveInteractiveDedupeId("default", undefined, "tk_1")).toBe(
      "feishu:default:tk_1",
    );
  });

  it("omits the key when neither id is present", () => {
    expect(resolveInteractiveDedupeId("default", undefined, undefined)).toBeUndefined();
  });

  it("produces distinct keys for distinct events (a re-click is not collapsed)", () => {
    const a = resolveInteractiveDedupeId("default", "ev_1", undefined);
    const b = resolveInteractiveDedupeId("default", "ev_2", undefined);
    expect(a).not.toBe(b);
  });

  it("scopes the key by account id", () => {
    expect(resolveInteractiveDedupeId("plaud", "ev_1", undefined)).toBe(
      "feishu:plaud:ev_1",
    );
  });
});

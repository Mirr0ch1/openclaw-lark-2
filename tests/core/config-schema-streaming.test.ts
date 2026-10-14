import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FeishuConfigSchema } = require("../../src/core/config-schema.js");

/**
 * P1-3 regression: the schema used to declare `streaming` as a boolean, so a
 * canonical (official-shaped) config `streaming: { mode: "partial" }` failed
 * validation and was stripped.
 */
describe("config-schema streaming", () => {
  it("accepts the canonical object form", () => {
    expect(FeishuConfigSchema.safeParse({ streaming: { mode: "partial" } }).success).toBe(true);
  });

  it("accepts the legacy boolean form", () => {
    expect(FeishuConfigSchema.safeParse({ streaming: true }).success).toBe(true);
    expect(FeishuConfigSchema.safeParse({ streaming: false }).success).toBe(true);
  });

  it("accepts the full live-config shape (mode + chunkMode + block)", () => {
    const r = FeishuConfigSchema.safeParse({
      streaming: { mode: "partial", chunkMode: "newline", block: { enabled: true, coalesce: { idleMs: 500 } } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid streaming mode", () => {
    expect(FeishuConfigSchema.safeParse({ streaming: { mode: "nope" } }).success).toBe(false);
  });

  it("accepts the official streaming chunkMode value `length`", () => {
    expect(FeishuConfigSchema.safeParse({ streaming: { chunkMode: "length" } }).success).toBe(true);
  });
});

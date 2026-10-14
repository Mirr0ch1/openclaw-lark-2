import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * P0 regression guard for a class of CJS bug: `exports.foo = require(...).foo`
 * creates NO local binding, so a bare `foo(...)` elsewhere in the same file
 * throws `ReferenceError` at runtime. That is exactly how `monitorFeishuWebhook`
 * used to fail for every webhook-mode account.
 */
describe("webhook.js — re-exported helpers must be called via their module namespace", () => {
  const src = readFileSync(resolve(process.cwd(), "src/channel/webhook.js"), "utf8");

  it("qualifies normalizeFeishuWebhookPath with `webhook_path_1.`", () => {
    // Any call not preceded by a `.` or word char is a bare identifier.
    const bareCall = /(?<![.\w])normalizeFeishuWebhookPath\s*\(/;
    expect(bareCall.test(src)).toBe(false);
    expect(src).toContain("webhook_path_1.normalizeFeishuWebhookPath(");
  });
});

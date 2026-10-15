import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolvePublicMediaReference } = require("../../src/messaging/outbound/deliver.js");

/**
 * Parity with the official `resolvePublicFeishuMediaReference`: only a
 * provably-public http(s) URL may be echoed as a clickable fallback link.
 * The negative cases below need no DNS (they are rejected before resolution).
 */
describe("resolvePublicMediaReference (media-fallback parity)", () => {
  it("rejects a local file path", async () => {
    expect(await resolvePublicMediaReference("/etc/passwd")).toBeUndefined();
    expect(await resolvePublicMediaReference("file:///etc/passwd")).toBeUndefined();
  });

  it("rejects private / loopback / link-local hosts", async () => {
    expect(await resolvePublicMediaReference("http://192.168.1.10/x.png")).toBeUndefined();
    expect(await resolvePublicMediaReference("http://127.0.0.1/x.png")).toBeUndefined();
    expect(await resolvePublicMediaReference("http://169.254.169.254/latest/meta-data")).toBeUndefined();
    expect(await resolvePublicMediaReference("http://localhost/x.png")).toBeUndefined();
  });

  it("rejects non-http(s) schemes and embedded credentials", async () => {
    expect(await resolvePublicMediaReference("ftp://example.com/x")).toBeUndefined();
    expect(await resolvePublicMediaReference("https://user:pass@example.com/x")).toBeUndefined();
  });

  it("rejects blank input and ASCII control characters", async () => {
    expect(await resolvePublicMediaReference("")).toBeUndefined();
    expect(await resolvePublicMediaReference(undefined)).toBeUndefined();
    expect(await resolvePublicMediaReference("https://example.com/a\u0000b")).toBeUndefined();
  });
});

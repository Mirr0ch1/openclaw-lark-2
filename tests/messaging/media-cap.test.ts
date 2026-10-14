import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  FEISHU_MAX_FILE_UPLOAD_BYTES,
  resolveOutboundMediaMaxBytes,
  readResponseBodyWithCap,
  uploadAndSendMediaLark,
} = require("../../src/messaging/outbound/media.js");

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-media-cap-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveOutboundMediaMaxBytes (C4a)", () => {
  it("defaults to 30MB when unconfigured", () => {
    expect(resolveOutboundMediaMaxBytes({} as never)).toBe(30 * 1024 * 1024);
  });

  it("honours a configured mediaMaxMb below the hard ceiling", () => {
    const cfg = { channels: { feishu: { mediaMaxMb: 5 } } };
    expect(resolveOutboundMediaMaxBytes(cfg as never)).toBe(5 * 1024 * 1024);
  });

  it("clamps a configured mediaMaxMb above the hard Feishu ceiling", () => {
    const cfg = { channels: { feishu: { mediaMaxMb: 100 } } };
    expect(resolveOutboundMediaMaxBytes(cfg as never)).toBe(FEISHU_MAX_FILE_UPLOAD_BYTES);
  });

  it("never exceeds the hard ceiling", () => {
    expect(FEISHU_MAX_FILE_UPLOAD_BYTES).toBe(30 * 1024 * 1024);
  });

  it("ignores a non-positive or non-finite mediaMaxMb (falls back to default)", () => {
    const base = 30 * 1024 * 1024;
    expect(resolveOutboundMediaMaxBytes({ channels: { feishu: { mediaMaxMb: 0 } } } as never)).toBe(base);
    expect(resolveOutboundMediaMaxBytes({ channels: { feishu: { mediaMaxMb: -5 } } } as never)).toBe(base);
    expect(resolveOutboundMediaMaxBytes({ channels: { feishu: { mediaMaxMb: NaN } } } as never)).toBe(base);
  });
});

describe("readResponseBodyWithCap (C4a)", () => {
  function streamResponse(chunks: Uint8Array[], contentLength?: number): Response {
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const headers = new Headers();
    if (contentLength !== undefined) headers.set("content-length", String(contentLength));
    return new Response(body, { headers });
  }

  it("returns the full body when within the cap", async () => {
    const resp = streamResponse([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const buf = await readResponseBodyWithCap(resp, 1024, "https://x/y");
    expect(buf.length).toBe(5);
  });

  it("rejects when the declared content-length exceeds the cap", async () => {
    const resp = streamResponse([new Uint8Array([1])], 5000);
    await expect(readResponseBodyWithCap(resp, 1024, "https://x/y")).rejects.toThrow(
      /upload limit/,
    );
  });

  it("rejects when the streamed body exceeds the cap", async () => {
    // 3 chunks of 10 bytes each, cap 20 → trips on the 3rd chunk.
    const resp = streamResponse([
      new Uint8Array(10),
      new Uint8Array(10),
      new Uint8Array(10),
    ]);
    await expect(readResponseBodyWithCap(resp, 20, "https://x/y")).rejects.toThrow(
      /upload limit/,
    );
  });

  it("falls back to arrayBuffer when the body is not a stream", async () => {
    const resp = { headers: new Headers(), arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
    const buf = await readResponseBodyWithCap(resp as never, 1024, "https://x/y");
    expect(buf.length).toBe(2);
  });

  it("rejects a non-streamed body over the cap", async () => {
    const resp = { headers: new Headers(), arrayBuffer: async () => new Uint8Array(50).buffer };
    await expect(readResponseBodyWithCap(resp as never, 10, "https://x/y")).rejects.toThrow(
      /upload limit/,
    );
  });
});

describe("uploadAndSendMediaLark — local file cap (C4a)", () => {
  it("rejects a local media file larger than the configured cap before upload", async () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "big.bin");
    fs.writeFileSync(file, Buffer.alloc(4096)); // 4 KB
    // mediaMaxMb ~0.001 → ~1 KB cap, well under the file size.
    const cfg = { channels: { feishu: { mediaMaxMb: 0.001 } } };
    await expect(
      uploadAndSendMediaLark({
        cfg,
        to: "oc_1",
        mediaUrl: file,
        mediaLocalRoots: [dir],
      }),
    ).rejects.toThrow(/upload limit/);
  });
});

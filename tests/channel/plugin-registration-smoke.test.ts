import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pluginModule = require("../../index.js");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "openclaw.plugin.json"), "utf8"),
);

function makeApi() {
  const reg = {
    channels: [] as unknown[],
    tools: [] as Array<{ name?: string }>,
    commands: [] as unknown[],
    cli: [] as unknown[],
    hooks: [] as string[],
  };
  const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
  const api = {
    runtime: {
      config: { current: () => ({}) },
      logging: { getChildLogger: () => noopLogger },
    },
    registerChannel: (x: unknown) => reg.channels.push(x),
    registerTool: (t: { name?: string }) => reg.tools.push(t),
    registerCommand: (c: unknown) => reg.commands.push(c),
    registerCli: (f: unknown, o: unknown) => reg.cli.push({ f, o }),
    on: (ev: string) => reg.hooks.push(ev),
    config: { channels: { feishu: { appId: "cli_x", appSecret: "s" } } },
    logger: noopLogger,
  };
  return { api, reg };
}

describe("plugin registration smoke", () => {
  it("registers the feishu channel without throwing", () => {
    const { api, reg } = makeApi();
    const plugin = pluginModule.default ?? pluginModule;
    expect(() => plugin.register(api)).not.toThrow();
    expect(reg.channels.length).toBeGreaterThan(0);
    const channel = reg.channels[0] as { plugin: { id: string } };
    expect(channel.plugin.id).toBe("feishu");
  });

  it("registers every tool declared in the manifest contracts", () => {
    const { api, reg } = makeApi();
    const plugin = pluginModule.default ?? pluginModule;
    plugin.register(api);
    const declared: string[] = manifest.contracts?.tools ?? [];
    const registered = new Set(reg.tools.map((t) => t.name).filter(Boolean) as string[]);
    const missing = declared.filter((name) => !registered.has(name));
    expect(missing, `unregistered declared tools: ${missing.join(", ")}`).toEqual([]);
    // And nothing is registered that isn't declared.
    const extra = [...registered].filter((name) => !declared.includes(name));
    expect(extra, `undeclared registered tools: ${extra.join(", ")}`).toEqual([]);
  });

  it("registers the diagnostic tool hooks defensively", () => {
    const { api, reg } = makeApi();
    const plugin = pluginModule.default ?? pluginModule;
    plugin.register(api);
    expect(reg.hooks).toContain("before_tool_call");
    expect(reg.hooks).toContain("after_tool_call");
  });
});

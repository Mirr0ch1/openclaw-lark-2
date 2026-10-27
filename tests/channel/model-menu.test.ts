import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildFeishuModelBrowseChannelData,
  buildFeishuModelsAddProviderChannelData,
  buildFeishuModelsListChannelData,
  buildFeishuModelsMenuChannelData,
  buildFeishuModelsProviderChannelData,
} = require("../../src/channel/model-menu.js");

type Button = { label: string; prompt: string };
type ChannelData = { feishu: { buttons: Button[]; buttonsPerRow?: number } };

const buttonsOf = (channelData: ChannelData | null): Button[] => channelData?.feishu.buttons ?? [];

describe("model picker → Feishu buttons", () => {
  it("offers a browse button that opens the provider list", () => {
    const channelData: ChannelData = buildFeishuModelBrowseChannelData();
    expect(buttonsOf(channelData).map((button) => button.prompt)).toEqual(["/models providers"]);
  });

  it("offers one button per provider", () => {
    const channelData: ChannelData = buildFeishuModelsMenuChannelData({
      providers: [{ id: "openai", count: 3 }, { id: "minimax", count: 1 }],
    });
    expect(buttonsOf(channelData).map((button) => button.label)).toEqual(["openai (3)", "minimax (1)"]);
    expect(buttonsOf(channelData).map((button) => button.prompt)).toEqual([
      "/models openai",
      "/models minimax",
    ]);
  });

  it("uses the same provider buttons for the provider hook", () => {
    const params = { providers: [{ id: "openai", count: 1 }] };
    expect(buildFeishuModelsProviderChannelData(params)).toEqual(
      buildFeishuModelsMenuChannelData(params),
    );
  });

  it("returns nothing when no provider is available", () => {
    expect(buildFeishuModelsMenuChannelData({ providers: [] })).toBeNull();
    expect(buildFeishuModelsAddProviderChannelData({ providers: [] })).toBeNull();
  });

  it("adds a provider through the deprecated add command", () => {
    const channelData: ChannelData = buildFeishuModelsAddProviderChannelData({
      providers: [{ id: "openai" }],
    });
    expect(buttonsOf(channelData).map((button) => button.prompt)).toEqual(["/models add openai"]);
  });

  it("lists the models of a provider with a session-scoped selection", () => {
    const channelData: ChannelData = buildFeishuModelsListChannelData({
      provider: "openai",
      models: ["gpt-4o", "gpt-5"],
      currentModel: "openai/gpt-5",
      currentPage: 1,
      totalPages: 1,
      pageSize: 8,
    });
    const buttons = buttonsOf(channelData);
    expect(buttons[0]?.prompt).toBe("/model openai/gpt-4o -s");
    // The current model is marked so the user can see what is active.
    expect(buttons[1]?.label).toBe("gpt-5 ✓");
    expect(buttons[1]?.prompt).toBe("/model openai/gpt-5 -s");
  });

  it("paginates and offers a way back to the provider list", () => {
    const channelData: ChannelData = buildFeishuModelsListChannelData({
      provider: "openai",
      models: ["a", "b", "c"],
      currentPage: 1,
      totalPages: 2,
      pageSize: 2,
    });
    const prompts = buttonsOf(channelData).map((button) => button.prompt);
    expect(prompts).toContain("/models openai 2");
    expect(prompts).toContain("/models providers");
  });

  it("puts long model labels on their own row", () => {
    const channelData: ChannelData = buildFeishuModelsListChannelData({
      provider: "openai",
      models: ["a"],
      currentPage: 1,
      totalPages: 1,
      pageSize: 8,
    });
    expect(channelData.feishu.buttonsPerRow).toBe(1);
  });

  it("falls back to a back button when the provider has no models", () => {
    const channelData: ChannelData = buildFeishuModelsListChannelData({
      provider: "openai",
      models: [],
      currentPage: 1,
      totalPages: 1,
    });
    expect(buttonsOf(channelData).map((button) => button.prompt)).toEqual(["/models providers"]);
  });
});

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  inspectFeishuIngressEnvelope,
  createFeishuDurableIngress,
} = require("../../src/channel/ingress.js");

function messageEnvelope(chatId = "oc_1", eventId = "ev_1") {
  return JSON.stringify({
    header: { event_type: "im.message.receive_v1", event_id: eventId },
    event: { message: { chat_id: chatId } },
  });
}

describe("inspectFeishuIngressEnvelope", () => {
  it("lanes message events by chat", () => {
    expect(inspectFeishuIngressEnvelope(messageEnvelope())).toEqual({
      eventId: "ev_1",
      laneKey: "chat:oc_1",
    });
  });

  it("lanes comment events by document", () => {
    const raw = JSON.stringify({
      header: { event_type: "drive.notice.comment_add_v1", event_id: "ev_2" },
      event: { notice_meta: { file_type: "docx", file_token: "tk" } },
    });
    expect(inspectFeishuIngressEnvelope(raw)).toEqual({
      eventId: "ev_2",
      laneKey: "comment-doc:docx:tk",
    });
  });

  it("returns null for non-durable or malformed envelopes", () => {
    // Card actions must stay non-durable so interactive dispatch is untouched.
    expect(
      inspectFeishuIngressEnvelope(
        JSON.stringify({ header: { event_type: "card.action.trigger", event_id: "x" } }),
      ),
    ).toBeNull();
    expect(inspectFeishuIngressEnvelope("not json")).toBeNull();
    expect(
      inspectFeishuIngressEnvelope(
        JSON.stringify({ header: { event_type: "im.message.receive_v1" } }),
      ),
    ).toBeNull();
  });

  it("admits recognised-but-lane-less events under an invalid lane when allowed", () => {
    const raw = JSON.stringify({
      header: { event_type: "im.message.receive_v1", event_id: "ev_3" },
      event: {},
    });
    expect(inspectFeishuIngressEnvelope(raw, { allowInvalidLane: true })).toEqual({
      eventId: "ev_3",
      laneKey: "invalid:im.message.receive_v1:ev_3",
    });
  });
});

describe("createFeishuDurableIngress", () => {
  it("returns null when the host exposes no ingress queue", () => {
    expect(
      createFeishuDurableIngress({
        accountId: "default",
        runtime: {},
        dispatcher: { invoke: async () => ({}) },
      }),
    ).toBeNull();
    expect(
      createFeishuDurableIngress({
        accountId: "default",
        runtime: { state: {} },
        dispatcher: { invoke: async () => ({}) },
      }),
    ).toBeNull();
  });
});

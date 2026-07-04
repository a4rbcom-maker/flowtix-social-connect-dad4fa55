import { describe, expect, it } from "vitest";
import {
  accumulateGroupMembers,
  computeGroupMemberCount,
  countAccumulated,
  createGroupMemberState,
  type GroupMemberMessage,
} from "@/lib/wa-group-members";

const GROUP = "120363000000000001@g.us";
const DM = "201001234567@s.whatsapp.net";

function msg(partial: Partial<GroupMemberMessage>): GroupMemberMessage {
  return { direction: "in", sender_phone: null, sender_name: null, ...partial };
}

describe("computeGroupMemberCount", () => {
  it("returns 0 for non-group JIDs (DM / null / lid)", () => {
    const messages = [msg({ sender_phone: "201001112222" })];
    expect(computeGroupMemberCount(messages, DM)).toBe(0);
    expect(computeGroupMemberCount(messages, null)).toBe(0);
    expect(computeGroupMemberCount(messages, undefined)).toBe(0);
    expect(computeGroupMemberCount(messages, "12345@lid")).toBe(0);
  });

  it("counts unique inbound senders by phone", () => {
    const messages = [
      msg({ sender_phone: "201001112222" }),
      msg({ sender_phone: "201001112222" }), // same member, still 1
      msg({ sender_phone: "201003334444" }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(2);
  });

  it("falls back to sender_name when phone is missing", () => {
    const messages = [
      msg({ sender_name: "Ahmed" }),
      msg({ sender_name: "Ahmed" }),
      msg({ sender_name: "Sara" }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(2);
  });

  it("ignores blank/whitespace-only identifiers so the count is not inflated", () => {
    const messages = [
      msg({ sender_phone: "   ", sender_name: "" }),
      msg({ sender_phone: "", sender_name: "  " }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(0);
  });

  it("includes the account owner (+1) whenever there is at least one outgoing message", () => {
    const messages = [
      msg({ direction: "out" }),
      msg({ sender_phone: "201001112222" }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(2); // owner + 1 member
  });

  it("counts the owner only once no matter how many outgoing messages there are", () => {
    const messages = [
      msg({ direction: "out" }),
      msg({ direction: "out" }),
      msg({ direction: "out" }),
      msg({ sender_phone: "201001112222" }),
      msg({ sender_phone: "201003334444" }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(3); // owner + 2 unique members
  });

  it("does NOT count the owner when there are no outgoing messages", () => {
    const messages = [
      msg({ sender_phone: "201001112222" }),
      msg({ sender_phone: "201003334444" }),
    ];
    expect(computeGroupMemberCount(messages, GROUP)).toBe(2);
  });

  it("handles a lone outgoing message as owner-only (count = 1)", () => {
    expect(computeGroupMemberCount([msg({ direction: "out" })], GROUP)).toBe(1);
  });

  it("returns 0 for an empty message list on a group JID", () => {
    expect(computeGroupMemberCount([], GROUP)).toBe(0);
  });
});

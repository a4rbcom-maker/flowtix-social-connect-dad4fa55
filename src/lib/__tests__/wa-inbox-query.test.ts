import { describe, expect, it } from "vitest";
import {
  buildInboxMessageQueryPlan,
  cleanAliasPhone,
  inboxJidAliases,
  isLidJid,
  isLidLocal,
  isMessageForActiveConversation,
} from "@/lib/wa-inbox-query";

const GROUP = "120363000000000001@g.us";
const DM = "201001234567@s.whatsapp.net";
const LID = "12345678901234@lid";
const LID_AS_SNET = "12345678901234@s.whatsapp.net"; // 14-digit local → LID-shaped

describe("wa-inbox-query — jid helpers", () => {
  it("classifies LID identifiers correctly", () => {
    expect(isLidLocal("12345678901234")).toBe(true);
    expect(isLidLocal("201001234567")).toBe(false);
    expect(isLidJid(LID)).toBe(true);
    expect(isLidJid(LID_AS_SNET)).toBe(true);
    expect(isLidJid(DM)).toBe(false);
    expect(isLidJid(GROUP)).toBe(false);
  });

  it("cleanAliasPhone drops LID-local values and normalizes digits", () => {
    expect(cleanAliasPhone("+20 100 123 4567", DM)).toBe("201001234567");
    expect(cleanAliasPhone("12345678901234", LID)).toBeNull(); // LID local, not a phone
    expect(cleanAliasPhone(null, DM)).toBeNull();
    expect(cleanAliasPhone("", DM)).toBeNull();
  });

  it("inboxJidAliases fans out @lid ↔ @s.whatsapp.net and NEVER includes @g.us", () => {
    const fromLid = inboxJidAliases(LID, null);
    expect(fromLid).toContain(LID);
    expect(fromLid).toContain(LID_AS_SNET);
    expect(fromLid.every((j) => !j.endsWith("@g.us"))).toBe(true);

    const fromDm = inboxJidAliases(DM, "201001234567");
    expect(fromDm).toContain(DM);
    expect(fromDm.every((j) => !j.endsWith("@g.us"))).toBe(true);
  });
});

describe("buildInboxMessageQueryPlan — group vs private separation", () => {
  it("group mode: only the @g.us JID is queried, no phone fallback, no aliases", () => {
    const plan = buildInboxMessageQueryPlan(GROUP, "201001234567");
    expect(plan.mode).toBe("group");
    expect(plan.jids).toEqual([GROUP]);
    expect(plan.phone).toBeNull();
    expect(plan.orClauses).toEqual([`remote_jid.eq.${GROUP}`]);
    // Group has strict eq — no extra shield needed for the same query.
    expect(plan.excludeGroups).toBe(false);
  });

  it("group mode never OR-s a phone even if the contact_phone happens to be set", () => {
    const plan = buildInboxMessageQueryPlan(GROUP, "201001234567");
    const flat = plan.orClauses.join("|");
    expect(flat).not.toMatch(/from_phone/);
    expect(flat).not.toMatch(/to_phone/);
  });

  it("private mode: aliases never contain @g.us and the plan enforces the exclusion shield", () => {
    const plan = buildInboxMessageQueryPlan(DM, "201001234567");
    expect(plan.mode).toBe("private");
    expect(plan.jids.every((j) => !j.endsWith("@g.us"))).toBe(true);
    expect(plan.excludeGroups).toBe(true);
    // The OR expression the route will pass to Supabase must not embed @g.us.
    const flat = plan.orClauses.join(",");
    expect(flat).not.toMatch(/@g\.us/);
  });

  it("private LID mode: fans out to @s.whatsapp.net twin and includes phone OR when a real phone is known", () => {
    const plan = buildInboxMessageQueryPlan(LID, "201001234567");
    expect(plan.mode).toBe("private");
    expect(plan.jids).toEqual(expect.arrayContaining([LID, LID_AS_SNET]));
    expect(plan.phone).toBe("201001234567");
    expect(plan.orClauses.some((c) => c.startsWith("remote_jid.in.("))).toBe(true);
    expect(plan.orClauses).toContain("from_phone.eq.201001234567");
    expect(plan.orClauses).toContain("to_phone.eq.201001234567");
  });

  it("private LID mode: skips phone OR when contact_phone is actually the LID local", () => {
    const plan = buildInboxMessageQueryPlan(LID, "12345678901234");
    expect(plan.phone).toBeNull();
    const flat = plan.orClauses.join("|");
    expect(flat).not.toMatch(/from_phone|to_phone/);
  });

  it("PostgREST .or() JID list is properly quoted so @/. don't split the filter", () => {
    const plan = buildInboxMessageQueryPlan(DM, "201001234567");
    const inClause = plan.orClauses.find((c) => c.startsWith("remote_jid.in.("));
    expect(inClause).toBeDefined();
    expect(inClause!).toMatch(/"[^"]+@s\.whatsapp\.net"/);
  });

  it("regression: no future edit can leak @g.us into a private chat's query", () => {
    // Simulate a caller passing a stray group-looking phone value.
    const plan = buildInboxMessageQueryPlan(DM, "201001234567");
    for (const clause of plan.orClauses) expect(clause).not.toMatch(/@g\.us/);
    for (const jid of plan.jids) expect(jid.endsWith("@g.us")).toBe(false);
    expect(plan.excludeGroups).toBe(true);
  });

  it("regression: no future edit can drop the @g.us JID from a group chat's query", () => {
    const plan = buildInboxMessageQueryPlan(GROUP, null);
    expect(plan.jids).toContain(GROUP);
    expect(plan.orClauses.join(",")).toContain(GROUP);
  });
});

describe("isMessageForActiveConversation — cross-conversation switch guard", () => {
  it("returns false when there is no active conversation", () => {
    expect(isMessageForActiveConversation(DM, null)).toBe(false);
    expect(isMessageForActiveConversation(DM, undefined)).toBe(false);
    expect(isMessageForActiveConversation(DM, "")).toBe(false);
  });

  it("group active: accepts only exact-matching @g.us rows", () => {
    expect(isMessageForActiveConversation(GROUP, GROUP)).toBe(true);
    expect(isMessageForActiveConversation("120363000000000999@g.us", GROUP)).toBe(false);
    // A DM row from a member must never render under the group header.
    expect(isMessageForActiveConversation(DM, GROUP)).toBe(false);
    expect(isMessageForActiveConversation(LID, GROUP)).toBe(false);
  });

  it("private active: rejects any @g.us row (stale placeholder from a previous group chat)", () => {
    expect(isMessageForActiveConversation(GROUP, DM)).toBe(false);
    expect(isMessageForActiveConversation(GROUP, LID)).toBe(false);
  });

  it("private active: accepts DM / LID rows", () => {
    expect(isMessageForActiveConversation(DM, DM)).toBe(true);
    expect(isMessageForActiveConversation(LID, LID)).toBe(true);
    expect(isMessageForActiveConversation(LID_AS_SNET, LID)).toBe(true);
  });

  it("switch scenario: filtering a mixed batch keeps only rows for the active JID", () => {
    const batch = [
      { id: "a", remote_jid: GROUP },
      { id: "b", remote_jid: DM },
      { id: "c", remote_jid: LID },
      { id: "d", remote_jid: "120363000000000999@g.us" },
    ];
    const forGroup = batch.filter((m) => isMessageForActiveConversation(m.remote_jid, GROUP));
    expect(forGroup.map((m) => m.id)).toEqual(["a"]);
    const forDm = batch.filter((m) => isMessageForActiveConversation(m.remote_jid, DM));
    expect(forDm.map((m) => m.id)).toEqual(["b", "c"]);
  });
});

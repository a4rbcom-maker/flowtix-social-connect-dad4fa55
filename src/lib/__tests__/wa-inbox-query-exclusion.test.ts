// Regression tests for two invariants of the WhatsApp inbox message query:
//
//   1. The `.not("remote_jid","like","%@g.us")` shield MUST always be applied
//      on private conversations — any future refactor that drops it will let
//      group rows leak into a private chat when a member's JID overlaps.
//
//   2. After collapsing the historical multi-query fan-out (one DB round-trip
//      per alias JID + one per phone) into a single OR-combined query, the
//      private path must still return exactly the same set of rows: the
//      canonical JID, the @lid/@s.whatsapp.net twin, and rows matched by
//      from_phone/to_phone — and nothing else.
//
// These tests simulate PostgREST's evaluation of the built plan against an
// in-memory dataset so we don't need a live database to lock the behaviour.

import { describe, expect, it } from "vitest";
import { buildInboxMessageQueryPlan } from "@/lib/wa-inbox-query";

type Row = {
  id: string;
  remote_jid: string;
  from_phone?: string | null;
  to_phone?: string | null;
};

const GROUP_A = "120363000000000001@g.us";
const GROUP_B = "120363000000000002@g.us";
const DM = "201001234567@s.whatsapp.net";
const LID = "12345678901234@lid";
const LID_TWIN = "12345678901234@s.whatsapp.net";
const OTHER_DM = "201009999999@s.whatsapp.net";

// Minimal evaluator that mirrors how Supabase applies the plan:
//   user_id = current  (assumed already scoped)
//   AND (orClauses joined by OR)
//   AND (NOT remote_jid LIKE '%@g.us') when excludeGroups
function applyPlan(rows: Row[], plan: ReturnType<typeof buildInboxMessageQueryPlan>): Row[] {
  const inMatch = plan.orClauses.find((c) => c.startsWith("remote_jid.in.("));
  const inSet = new Set<string>();
  if (inMatch) {
    const inner = inMatch.slice("remote_jid.in.(".length, -1);
    for (const raw of inner.split(",")) inSet.add(raw.replace(/^"|"$/g, ""));
  }
  const eqJids = plan.orClauses
    .filter((c) => c.startsWith("remote_jid.eq."))
    .map((c) => c.slice("remote_jid.eq.".length));
  const fromPhones = plan.orClauses
    .filter((c) => c.startsWith("from_phone.eq."))
    .map((c) => c.slice("from_phone.eq.".length));
  const toPhones = plan.orClauses
    .filter((c) => c.startsWith("to_phone.eq."))
    .map((c) => c.slice("to_phone.eq.".length));

  return rows.filter((r) => {
    const orHit =
      inSet.has(r.remote_jid) ||
      eqJids.includes(r.remote_jid) ||
      (r.from_phone != null && fromPhones.includes(r.from_phone)) ||
      (r.to_phone != null && toPhones.includes(r.to_phone));
    if (!orHit) return false;
    if (plan.excludeGroups && r.remote_jid.endsWith("@g.us")) return false;
    return true;
  });
}

describe("@g.us exclusion shield on the private inbox query", () => {
  const rows: Row[] = [
    { id: "grp-a", remote_jid: GROUP_A, from_phone: "201001234567" }, // group msg authored by DM's owner
    { id: "grp-b", remote_jid: GROUP_B, to_phone: "201001234567" },
    { id: "dm-1", remote_jid: DM, from_phone: "201001234567" },
    { id: "dm-2", remote_jid: DM, to_phone: "201001234567" },
    { id: "lid-1", remote_jid: LID },
    { id: "twin-1", remote_jid: LID_TWIN },
    { id: "other", remote_jid: OTHER_DM, from_phone: "201009999999" },
  ];

  it("private DM query: no @g.us row appears even when the group message shares the phone", () => {
    const plan = buildInboxMessageQueryPlan(DM, "201001234567");
    const result = applyPlan(rows, plan);
    for (const r of result) expect(r.remote_jid.endsWith("@g.us")).toBe(false);
    // Group rows authored by the same phone MUST be excluded.
    expect(result.map((r) => r.id)).not.toContain("grp-a");
    expect(result.map((r) => r.id)).not.toContain("grp-b");
  });

  it("private LID query: excludes @g.us even for LID-shaped conversations", () => {
    const plan = buildInboxMessageQueryPlan(LID, "201001234567");
    const result = applyPlan(
      [...rows, { id: "grp-lid", remote_jid: GROUP_A, from_phone: "201001234567" }],
      plan,
    );
    expect(result.every((r) => !r.remote_jid.endsWith("@g.us"))).toBe(true);
  });

  it("the shield flag is explicit on the plan — refactors that drop it fail loudly", () => {
    expect(buildInboxMessageQueryPlan(DM, "201001234567").excludeGroups).toBe(true);
    expect(buildInboxMessageQueryPlan(LID, null).excludeGroups).toBe(true);
    expect(buildInboxMessageQueryPlan(GROUP_A, null).excludeGroups).toBe(false);
  });
});

describe("private path correctness after reducing to a single OR-combined query", () => {
  const rows: Row[] = [
    { id: "canon-from", remote_jid: DM, from_phone: "201001234567" },
    { id: "canon-to", remote_jid: DM, to_phone: "201001234567" },
    { id: "lid", remote_jid: LID },
    { id: "twin", remote_jid: LID_TWIN },
    { id: "phone-only-from", remote_jid: "201001234567@s.whatsapp.net", from_phone: "201001234567" },
    { id: "phone-only-to", remote_jid: "999@s.whatsapp.net", to_phone: "201001234567" },
    { id: "unrelated", remote_jid: OTHER_DM, from_phone: "201009999999" },
    { id: "group-noise", remote_jid: GROUP_A, from_phone: "201001234567" },
  ];

  it("DM: returns all alias/phone matches and nothing else — single-query parity", () => {
    const plan = buildInboxMessageQueryPlan(DM, "201001234567");
    // Sanity: this is a single OR-combined query (one .or() call), not per-alias fan-out.
    expect(plan.orClauses.length).toBeGreaterThan(0);
    const result = applyPlan(rows, plan).map((r) => r.id).sort();
    expect(result).toEqual(
      ["canon-from", "canon-to", "phone-only-from", "phone-only-to"].sort(),
    );
  });

  it("LID: single query still returns the LID row + its @s.whatsapp.net twin + phone matches", () => {
    const plan = buildInboxMessageQueryPlan(LID, "201001234567");
    const result = applyPlan(rows, plan).map((r) => r.id).sort();
    expect(result).toEqual(
      ["canon-from", "canon-to", "lid", "twin", "phone-only-from", "phone-only-to"].sort(),
    );
  });

  it("DM without a known phone: query narrows to JID aliases only, unrelated rows excluded", () => {
    const plan = buildInboxMessageQueryPlan(DM, null);
    expect(plan.phone).toBeNull();
    expect(plan.orClauses.some((c) => c.includes("from_phone"))).toBe(false);
    expect(plan.orClauses.some((c) => c.includes("to_phone"))).toBe(false);
    const result = applyPlan(rows, plan).map((r) => r.id).sort();
    expect(result).toEqual(["canon-from", "canon-to"].sort());
  });

  it("group query stays scoped to the exact @g.us JID and skips other groups + DMs", () => {
    const plan = buildInboxMessageQueryPlan(GROUP_A, null);
    const result = applyPlan(
      [
        ...rows,
        { id: "grp-a-2", remote_jid: GROUP_A },
        { id: "grp-b-1", remote_jid: GROUP_B },
      ],
      plan,
    );
    expect(result.map((r) => r.id).sort()).toEqual(["grp-a-2", "group-noise"].sort());
  });
});

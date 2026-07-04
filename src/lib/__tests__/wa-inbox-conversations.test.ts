/**
 * Conversation ordering & grouping guardrail — WhatsApp inbox sidebar.
 *
 * يتحقّق أن ترتيب المحادثات وتجميعها بعد dedupe يظل صحيحاً حتى مع دفعات
 * realtime التي تحمل رسائل متأخرة:
 *   - المحادثة صاحبة أحدث last_message_at تبقى على القمة.
 *   - وصول رسالة أحدث (via _sort_at) يرفع المحادثة فوراً للقمة.
 *   - رسالة متأخرة (created_at أقدم) لا تُقدّم محادثتها فوق أخرى أحدث.
 *   - LID / @s.whatsapp.net / phone aliases لنفس جهة الاتصال تُدمج في صف
 *     واحد، وnewest alias يُعطي التوقيت والمعاينة.
 */
import { describe, expect, it } from "vitest";
import {
  compareConversationsByLastRealActivity,
  conversationIdentities,
  conversationSortMs,
  groupSortConversations,
  mergeConversationAliases,
  type RankedConversationRow,
} from "@/lib/wa-inbox-conversations";
import type { ConversationRow } from "@/lib/wa-chat.functions";

const mk = (over: Partial<RankedConversationRow>): RankedConversationRow => ({
  id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
  session_id: "session-1",
  remote_jid: "201001234567@s.whatsapp.net",
  contact_name: null,
  contact_phone: null,
  profile_pic_url: null,
  last_message_text: "hi",
  last_message_at: "2026-07-04T10:00:00.000Z",
  last_direction: "in",
  unread_count: 0,
  ai_enabled: false,
  ...over,
} as RankedConversationRow);

describe("compareConversationsByLastRealActivity — order after late updates", () => {
  it("محادثة الأحدث last_message_at تسبق دائماً", () => {
    const older = mk({ id: "a", last_message_at: "2026-07-04T09:00:00.000Z" });
    const newer = mk({ id: "b", last_message_at: "2026-07-04T11:00:00.000Z" });
    const out = [older, newer].sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("_sort_at (من realtime message) يتفوّق على last_message_at", () => {
    // A: last_message_at أقدم لكن جاءت رسالة realtime أحدث → _sort_at أعلى.
    const a = mk({ id: "a", last_message_at: "2026-07-04T09:00:00.000Z", _sort_at: "2026-07-04T12:00:00.000Z" });
    const b = mk({ id: "b", last_message_at: "2026-07-04T11:00:00.000Z" });
    const out = [b, a].sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("رسالة متأخرة لمحادثة قديمة (_sort_at أقدم من last_message_at لمحادثة أخرى) لا ترفعها", () => {
    // A: نشاطها الفعلي قديم (09:00) رغم أن رسالة متأخرة وصلت — _sort_at يعكس الحقيقة.
    const a = mk({ id: "a", last_message_at: "2026-07-04T09:00:00.000Z", _sort_at: "2026-07-04T09:00:00.000Z" });
    const b = mk({ id: "b", last_message_at: "2026-07-04T11:00:00.000Z" });
    const out = [a, b].sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("محادثة بلا معاينة/unread تُدفع للأسفل حتى لو last_message_at حديث", () => {
    const empty = mk({ id: "empty", last_message_text: "", unread_count: 0, last_message_at: "2026-07-04T12:00:00.000Z" });
    const real = mk({ id: "real", last_message_text: "hi", last_message_at: "2026-07-04T10:00:00.000Z" });
    const out = [empty, real].sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.id)).toEqual(["real", "empty"]);
  });

  it("unread_count > 0 يُعتبر نشاطاً حتى بدون معاينة نصية", () => {
    const unread = mk({ id: "u", last_message_text: null, unread_count: 3, last_message_at: "2026-07-04T12:00:00.000Z" });
    const preview = mk({ id: "p", last_message_text: "hi", last_message_at: "2026-07-04T10:00:00.000Z" });
    const out = [preview, unread].sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.id)).toEqual(["u", "p"]);
  });

  it("tiebreaker مستقر: نفس التوقيت → ترتيب أبجدي بحسب الاسم/الهاتف/الـjid", () => {
    const t = "2026-07-04T10:00:00.000Z";
    const rows = [
      mk({ id: "c", contact_name: "Charlie", last_message_at: t }),
      mk({ id: "a", contact_name: "Alice",   last_message_at: t }),
      mk({ id: "b", contact_name: "Bob",     last_message_at: t }),
    ];
    const out = rows.sort(compareConversationsByLastRealActivity);
    expect(out.map((c) => c.contact_name)).toEqual(["Alice", "Bob", "Charlie"]);
  });
});

describe("mergeConversationAliases — newest alias wins for last_*", () => {
  it("دمج LID + @s.whatsapp.net: أحدث alias يعطي last_message_at/_text/_direction", () => {
    const lid = mk({
      id: "lid",
      remote_jid: "12345678901234@lid",
      last_message_at: "2026-07-04T09:00:00.000Z",
      last_message_text: "قديم",
      last_direction: "in",
    });
    const snet = mk({
      id: "snet",
      remote_jid: "201001234567@s.whatsapp.net",
      contact_phone: "201001234567",
      last_message_at: "2026-07-04T11:30:00.000Z",
      last_message_text: "الأحدث",
      last_direction: "out",
    });
    const merged = mergeConversationAliases([lid, snet]);
    expect(merged.last_message_at).toBe("2026-07-04T11:30:00.000Z");
    expect(merged.last_message_text).toBe("الأحدث");
    expect(merged.last_direction).toBe("out");
    // preferred=LID للهوية الثابتة، لكن التوقيت يأتي من newest.
    expect(merged.remote_jid).toBe("12345678901234@lid");
  });

  it("unread_count = مجموع كل الـaliases", () => {
    const a = mk({ remote_jid: "12345678901234@lid", unread_count: 2 });
    const b = mk({ remote_jid: "201001234567@s.whatsapp.net", contact_phone: "201001234567", unread_count: 5 });
    expect(mergeConversationAliases([a, b]).unread_count).toBe(7);
  });

  it("ai_enabled = OR على كل الـaliases", () => {
    const a = mk({ remote_jid: "12345678901234@lid", ai_enabled: false });
    const b = mk({ remote_jid: "201001234567@s.whatsapp.net", contact_phone: "201001234567", ai_enabled: true });
    expect(mergeConversationAliases([a, b]).ai_enabled).toBe(true);
  });
});

describe("groupSortConversations — end-to-end pipeline", () => {
  it("aliasان لنفس الجهة يظهران كصف واحد في المكان الصحيح", () => {
    const rows: ConversationRow[] = [
      mk({ id: "lid", remote_jid: "12345678901234@lid", last_message_at: "2026-07-04T09:00:00.000Z", contact_phone: "201001234567" }),
      mk({ id: "snet", remote_jid: "12345678901234@s.whatsapp.net", contact_phone: "201001234567", last_message_at: "2026-07-04T11:00:00.000Z", last_message_text: "أحدث" }),
      mk({ id: "other", remote_jid: "201005555555@s.whatsapp.net", contact_phone: "201005555555", last_message_at: "2026-07-04T10:00:00.000Z" }),
    ];
    const out = groupSortConversations(rows);
    expect(out).toHaveLength(2); // الـaliasان اندمجا
    // الصف المدمج (11:00) قبل other (10:00).
    expect(out[0].last_message_at).toBe("2026-07-04T11:00:00.000Z");
    expect(out[1].id).toBe("other");
  });

  it("سيناريو realtime: رسالة متأخرة تصل لمحادثة بأسفل القائمة → ترتفع فوراً", () => {
    const rows: ConversationRow[] = [
      mk({ id: "top", last_message_at: "2026-07-04T12:00:00.000Z", remote_jid: "201002222222@s.whatsapp.net" }),
      mk({ id: "middle", last_message_at: "2026-07-04T11:00:00.000Z", remote_jid: "201003333333@s.whatsapp.net" }),
      mk({ id: "bottom", last_message_at: "2026-07-04T09:00:00.000Z", remote_jid: "201004444444@s.whatsapp.net" }),
    ];
    // قبل الرسالة الجديدة:
    expect(groupSortConversations(rows).map((c) => c.id)).toEqual(["top", "middle", "bottom"]);
    // بعد realtime INSERT: bottom استقبلت رسالة أحدث (12:30) → last_message_at تحدّث في DB.
    const afterRealtime = rows.map((c) => c.id === "bottom" ? mk({ ...c, last_message_at: "2026-07-04T12:30:00.000Z", last_message_text: "hi late" }) : c);
    expect(groupSortConversations(afterRealtime).map((c) => c.id)).toEqual(["bottom", "top", "middle"]);
  });

  it("regression: 200 محادثة بترتيب عشوائي + 50 alias مكرر → dedupe تام والقمة دائماً الأحدث", () => {
    const T0 = 1_760_000_000_000;
    const rows: ConversationRow[] = [];
    for (let i = 0; i < 200; i++) {
      rows.push(mk({
        id: `c${i}`,
        remote_jid: `20100${(1000000 + i).toString()}@s.whatsapp.net`,
        contact_phone: `20100${1000000 + i}`,
        last_message_at: new Date(T0 + i * 1000).toISOString(),
      }));
    }
    // 50 alias مكرر لأول 50 محادثة (نفس الرقم، remote_jid=@lid).
    for (let i = 0; i < 50; i++) {
      rows.push(mk({
        id: `alias-${i}`,
        remote_jid: `${(20000000000000 + i).toString()}@lid`,
        contact_phone: `20100${1000000 + i}`,
        last_message_at: new Date(T0 + i * 1000 + 100).toISOString(),
      }));
    }
    // اخلط.
    rows.sort(() => Math.random() - 0.5);
    const out = groupSortConversations(rows);
    // 200 محادثة فريدة + الـaliases اندمجت → 200 صف.
    expect(out).toHaveLength(200);
    // القمة هي التي لها آخر last_message_at (i=199 → T0+199000).
    expect(conversationSortMs(out[0])).toBeGreaterThanOrEqual(conversationSortMs(out[1]));
    // ترتيب تنازلي محكم.
    for (let i = 1; i < out.length; i++) {
      expect(conversationSortMs(out[i - 1])).toBeGreaterThanOrEqual(conversationSortMs(out[i]));
    }
  });
});

describe("conversationIdentities — grouping keys", () => {
  it("LID + @s.whatsapp.net بنفس local ينتجان نفس مفتاح lid:", () => {
    const idsLid = conversationIdentities(
      mk({ remote_jid: "12345678901234@lid" }),
      new Set(["12345678901234"]),
    );
    const idsSnet = conversationIdentities(
      mk({ remote_jid: "12345678901234@s.whatsapp.net" }),
      new Set(["12345678901234"]),
    );
    expect(idsLid).toContain("lid:12345678901234");
    expect(idsSnet).toContain("lid:12345678901234");
  });

  it("جروب @g.us لا يحصل على مفتاح lid:", () => {
    const ids = conversationIdentities(
      mk({ remote_jid: "120363000000000001@g.us" }),
      new Set(),
    );
    expect(ids.some((k) => k.startsWith("lid:"))).toBe(false);
  });
});

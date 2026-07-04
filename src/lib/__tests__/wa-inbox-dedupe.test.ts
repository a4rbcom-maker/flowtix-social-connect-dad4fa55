/**
 * Dedupe guardrail — WhatsApp inbox message list.
 *
 * يضمن أن دمج (server rows + optimistic + realtime + pagination) لا يُنتج
 * تكراراً في الفقاعات، وأن الرسائل المتأخرة تدخل بالمكان الصحيح بحسب
 * created_at. مربوط بـ src/lib/wa-inbox-dedupe.ts، والذي يستخدمه مسار
 * inbox عند بناء mergedMessages.
 */
import { describe, expect, it } from "vitest";
import { dedupeAndSortMessages } from "@/lib/wa-inbox-dedupe";
import type { ChatMessageRow } from "@/lib/wa-chat.functions";

const base = (over: Partial<ChatMessageRow>): ChatMessageRow => ({
  id: "id",
  remote_jid: "201001234567@s.whatsapp.net",
  direction: "in",
  status: "delivered",
  text_body: "hi",
  msg_type: "text",
  media_url: null,
  created_at: "2026-07-04T10:00:00.000Z",
  is_ai: false,
  sender_name: null,
  sender_phone: null,
  ...over,
});

describe("dedupeAndSortMessages — id-based dedup", () => {
  it("نفس الـid المكرر يظهر مرة واحدة فقط (realtime + refetch race)", () => {
    const rows = [
      base({ id: "a", created_at: "2026-07-04T10:00:00.000Z" }),
      base({ id: "a", created_at: "2026-07-04T10:00:00.000Z" }),
      base({ id: "a", created_at: "2026-07-04T10:00:00.000Z" }),
    ];
    const out = dedupeAndSortMessages(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("عند تكرار الـid يفوز الصف الأحدث created_at (تحديث delivery متأخر)", () => {
    const older = base({ id: "x", status: "sent", created_at: "2026-07-04T10:00:00.000Z" });
    const newer = base({ id: "x", status: "delivered", created_at: "2026-07-04T10:00:05.000Z" });
    const out = dedupeAndSortMessages([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("delivered");
  });

  it("الصف الحقيقي يتفوّق على المتفائل لنفس الـid حتى لو أقدم", () => {
    const optimistic = base({
      id: "optimistic-xyz",
      status: "pending",
      queued_id: "q1",
      created_at: "2026-07-04T10:00:10.000Z",
    });
    const real = base({
      id: "optimistic-xyz",
      status: "sent",
      queued_id: "q1",
      created_at: "2026-07-04T10:00:00.000Z",
    });
    const out = dedupeAndSortMessages([optimistic, real]);
    expect(out[0].status).toBe("sent");
  });
});

describe("dedupeAndSortMessages — optimistic ↔ real pairing via queued_id", () => {
  it("الصف المتفائل يُحذف عند وصول الصف الحقيقي بنفس queued_id (id مختلف)", () => {
    const optimistic = base({
      id: "optimistic-1",
      status: "pending",
      queued_id: "q-42",
      created_at: "2026-07-04T10:00:00.000Z",
    });
    const real = base({
      id: "server-uuid-1",
      status: "sent",
      queued_id: "q-42",
      created_at: "2026-07-04T10:00:00.500Z",
    });
    const out = dedupeAndSortMessages([optimistic, real]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("server-uuid-1");
  });

  it("متفائل بلا queued_id لا يُحذف تلقائياً", () => {
    const optimistic = base({ id: "optimistic-solo", status: "pending", created_at: "2026-07-04T10:00:00.000Z" });
    const real = base({ id: "server-other", status: "sent", created_at: "2026-07-04T10:00:01.000Z" });
    const out = dedupeAndSortMessages([optimistic, real]);
    expect(out).toHaveLength(2);
  });
});

describe("dedupeAndSortMessages — late-arriving messages", () => {
  it("رسالة متأخرة تدخل في مكانها الزمني الصحيح لا في الآخر", () => {
    const rows = [
      base({ id: "1", created_at: "2026-07-04T10:00:00.000Z" }),
      base({ id: "3", created_at: "2026-07-04T10:00:20.000Z" }),
      base({ id: "2", created_at: "2026-07-04T10:00:10.000Z" }), // متأخرة
    ];
    const out = dedupeAndSortMessages(rows);
    expect(out.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("نفس التوقيت → ترتيب مستقر بحسب id (يمنع jitter في React keys)", () => {
    const t = "2026-07-04T10:00:00.000Z";
    const rows = [
      base({ id: "c", created_at: t }),
      base({ id: "a", created_at: t }),
      base({ id: "b", created_at: t }),
    ];
    const out = dedupeAndSortMessages(rows);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("dedupeAndSortMessages — pagination + realtime scenarios", () => {
  it("سيناريو: pagination أعاد صفوفاً موجودة أصلاً + realtime insert جديد = صفر تكرار", () => {
    const initial = [
      base({ id: "m1", created_at: "2026-07-04T09:00:00.000Z" }),
      base({ id: "m2", created_at: "2026-07-04T09:05:00.000Z" }),
    ];
    // مستخدم عمل scroll-up → السيرفر أعاد m1 مرة أخرى + m0 الأقدم.
    const olderPage = [
      base({ id: "m0", created_at: "2026-07-04T08:55:00.000Z" }),
      base({ id: "m1", created_at: "2026-07-04T09:00:00.000Z" }), // مكرر
    ];
    // بالتوازي وصل realtime INSERT لـ m3.
    const realtime = [base({ id: "m3", created_at: "2026-07-04T09:10:00.000Z" })];
    const out = dedupeAndSortMessages([...initial, ...olderPage, ...realtime]);
    expect(out.map((r) => r.id)).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("idempotent: تشغيل الدالة مرتين على نفس المدخلات ينتج نفس المخرجات", () => {
    const rows = [
      base({ id: "a", created_at: "2026-07-04T10:00:00.000Z" }),
      base({ id: "a", created_at: "2026-07-04T10:00:00.000Z" }),
      base({ id: "b", created_at: "2026-07-04T10:00:01.000Z" }),
    ];
    const once = dedupeAndSortMessages(rows);
    const twice = dedupeAndSortMessages(once);
    expect(twice).toEqual(once);
  });

  it("طلب دفعة realtime كبيرة (100 رسالة) بينها 30 مكرر = 70 فريد فقط", () => {
    const rows: ChatMessageRow[] = [];
    for (let i = 0; i < 70; i++) {
      rows.push(base({ id: `r${i}`, created_at: new Date(1_760_000_000_000 + i * 1000).toISOString() }));
    }
    // كرّر أول 30 (كأن refetch أعادها).
    for (let i = 0; i < 30; i++) rows.push(rows[i]);
    const out = dedupeAndSortMessages(rows);
    expect(out).toHaveLength(70);
    expect(new Set(out.map((r) => r.id)).size).toBe(70);
  });
});

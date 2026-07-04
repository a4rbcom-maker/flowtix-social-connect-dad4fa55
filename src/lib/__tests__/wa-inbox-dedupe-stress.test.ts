/**
 * Stress guardrail — WhatsApp inbox dedupe under realtime × pagination race.
 *
 * يحاكي أسوأ سيناريو حمل عالي:
 *   - N من الرسائل تصل بترتيب عشوائي عبر مسارات متعدّدة (server refetch،
 *     pagination pages، realtime bursts، optimistic echoes، late updates).
 *   - يخلط الدفعات في ترتيب زمني عشوائي ويشغّل dedupeAndSortMessages
 *     تراكمياً كما يفعل React عند كل re-render.
 *   - يتحقّق: 0 تكرار، الترتيب مطابق للـcreated_at، idempotent، ولا يوجد
 *     أي id فُقد بسبب race.
 */
import { describe, expect, it } from "vitest";
import { dedupeAndSortMessages } from "@/lib/wa-inbox-dedupe";
import type { ChatMessageRow } from "@/lib/wa-chat.functions";

function mk(id: string, tsMs: number, over: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id,
    remote_jid: "201001234567@s.whatsapp.net",
    direction: "in",
    status: "delivered",
    text_body: `msg-${id}`,
    msg_type: "text",
    media_url: null,
    created_at: new Date(tsMs).toISOString(),
    is_ai: false,
    sender_name: null,
    sender_phone: null,
    ...over,
  };
}

// PRNG صغير قابل للتكرار — يمنع flakiness ويسمح بالتحقيق حال الفشل.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("dedupe under realtime × pagination stress", () => {
  it("1000 رسالة موزّعة على 5 مسارات متسابقة → 0 تكرار، ترتيب زمني صحيح", () => {
    const rand = mulberry32(42);
    const N = 1000;
    const T0 = 1_760_000_000_000;
    const canonical: ChatMessageRow[] = [];
    for (let i = 0; i < N; i++) canonical.push(mk(`m${i.toString().padStart(4, "0")}`, T0 + i * 1000));

    // كل مسار "يرى" مجموعة جزئية متداخلة من الرسائل.
    const initialFetch = canonical.slice(700);              // آخر 300 رسالة
    const olderPage1   = canonical.slice(400, 800);         // pagination — يتقاطع مع initial
    const olderPage2   = canonical.slice(100, 500);         // pagination أعمق — يتقاطع مع page1
    const oldestPage   = canonical.slice(0, 150);           // أقصى الأقدم — يتقاطع مع page2
    // realtime bursts: 200 من الرسائل تصل مرة ثانية (INSERT/UPDATE races).
    const realtimeBurst = shuffle(canonical, rand).slice(0, 200);

    // كل مسار يصل بترتيب عشوائي داخلياً ثم نجمعها بترتيب عشوائي بينها.
    const paths = [initialFetch, olderPage1, olderPage2, oldestPage, realtimeBurst].map((p) => shuffle(p, rand));
    const merged = shuffle(paths.flat(), rand);

    const out = dedupeAndSortMessages(merged);
    expect(out).toHaveLength(N);
    expect(new Set(out.map((r) => r.id)).size).toBe(N);
    // ترتيب زمني تصاعدي — الرسائل المتأخرة والمكرّرة كلها استقرّت في مكانها.
    for (let i = 1; i < out.length; i++) {
      expect(Date.parse(out[i].created_at)).toBeGreaterThanOrEqual(Date.parse(out[i - 1].created_at));
    }
    expect(out.map((r) => r.id)).toEqual(canonical.map((r) => r.id));
  });

  it("تحديثات متأخرة (delivery status) لنفس id مع realtime burst → أحدث نسخة تفوز", () => {
    const rand = mulberry32(7);
    const T0 = 1_760_000_000_000;
    // 300 رسالة، كل واحدة تصل 3 مرات: sent → delivered → read (زمن أحدث).
    const versions: ChatMessageRow[] = [];
    for (let i = 0; i < 300; i++) {
      const id = `u${i}`;
      versions.push(mk(id, T0 + i * 1000, { status: "sent", direction: "out" }));
      versions.push(mk(id, T0 + i * 1000 + 200, { status: "delivered", direction: "out" }));
      versions.push(mk(id, T0 + i * 1000 + 500, { status: "read", direction: "out" }));
    }
    const out = dedupeAndSortMessages(shuffle(versions, rand));
    expect(out).toHaveLength(300);
    for (const r of out) expect(r.status).toBe("read"); // أحدث created_at
  });

  it("تدفق تراكمي (كل frame يضيف batch) → dedupe idempotent لا يفقد ولا يكرر", () => {
    const rand = mulberry32(99);
    const T0 = 1_760_000_000_000;
    const N = 500;
    const canonical: ChatMessageRow[] = [];
    for (let i = 0; i < N; i++) canonical.push(mk(`c${i.toString().padStart(3, "0")}`, T0 + i * 500));

    // نحاكي 20 frame — كل frame يضيف 50 رسالة عشوائية (مع تكرارات).
    let state: ChatMessageRow[] = [];
    for (let frame = 0; frame < 20; frame++) {
      const batch = shuffle(canonical, rand).slice(0, 50);
      state = dedupeAndSortMessages([...state, ...batch]);
      // في كل frame: 0 تكرار مضمون.
      expect(new Set(state.map((r) => r.id)).size).toBe(state.length);
    }
    // بعد 20 frame غالباً غطّت كل الرسائل — لا يزيد ولا ينقص عن canonical.
    for (const r of state) expect(canonical.some((c) => c.id === r.id)).toBe(true);
  });

  it("optimistic ↔ real pairing تحت حمل: 100 رسالة مُرسَلة + realtime ACKs عشوائية = 100 صف نهائي فقط", () => {
    const rand = mulberry32(13);
    const T0 = 1_760_000_000_000;
    const optimistic: ChatMessageRow[] = [];
    const real: ChatMessageRow[] = [];
    for (let i = 0; i < 100; i++) {
      const q = `q-${i}`;
      optimistic.push(
        mk(`optimistic-${i}`, T0 + i * 100, { status: "pending", direction: "out", queued_id: q }),
      );
      real.push(
        mk(`srv-${i}`, T0 + i * 100 + 300, { status: "sent", direction: "out", queued_id: q }),
      );
    }
    // نصف الـACKs يصل قبل، والنصف بعد (realtime jitter).
    const shuffled = shuffle([...optimistic, ...real], rand);
    const out = dedupeAndSortMessages(shuffled);
    expect(out).toHaveLength(100);
    // كل الصفوف النهائية حقيقية (srv-*)، ولا يوجد optimistic-* عالق.
    expect(out.every((r) => r.id.startsWith("srv-"))).toBe(true);
    expect(out.every((r) => r.status === "sent")).toBe(true);
  });

  it("regression: dedupe لا يعتمد على ترتيب الإدخال — 10 عشوائيات مختلفة = نفس المخرَج", () => {
    const T0 = 1_760_000_000_000;
    const canonical: ChatMessageRow[] = [];
    for (let i = 0; i < 200; i++) canonical.push(mk(`r${i}`, T0 + i * 1000));
    const withDupes = [...canonical, ...canonical.slice(0, 50), ...canonical.slice(150)];
    const expected = dedupeAndSortMessages(withDupes).map((r) => r.id);
    for (let seed = 1; seed <= 10; seed++) {
      const rand = mulberry32(seed);
      const shuffled = shuffle(withDupes, rand);
      const got = dedupeAndSortMessages(shuffled).map((r) => r.id);
      expect(got).toEqual(expected);
    }
  });
});

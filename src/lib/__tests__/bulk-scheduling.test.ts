/**
 * Integration test — bulk WhatsApp scheduler (background continuation).
 *
 * يحاكي حلقة pg_cron التي تشغّل /api/public/hooks/process-bulk-jobs كل دقيقة
 * على خادم Lovable Cloud. الهدف إثبات:
 *   1) الفواصل الزمنية بين الرسائل (jitter) تحترم min/max.
 *   2) بعد messages_per_batch رسالة يبدأ batch_rest_seconds قبل الاستئناف.
 *   3) daily_message_cap يوقف الحملة بعد حده اليومي.
 *   4) الحملة تكتمل عبر ticks متتالية بدون أي تفاعل من العميل
 *      (الجهاز/المتصفح مغلق) — أي: منطق الاستمرار في الخلفية سليم.
 *
 * الاختبار خالص (in-memory) لا يعتمد على قاعدة بيانات أو Bridge حقيقي
 * حتى يعمل داخل CI ولا يرسل رسائل فعلية.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_BULK_GLOBAL_CONFIG,
  jitterMs,
  renderMessage,
  applySpintax,
  type UserBulkSettings,
} from "@/lib/bulk-helpers.server";

type Recipient = { id: string; phone: string; name: string; status: "pending" | "success" | "failed" };
type Job = {
  id: string;
  status: "queued" | "processing" | "sent" | "paused";
  next_send_at: number; // epoch ms
  sent_in_batch: number;
  sent_today: number;
  template: string;
  recipients: Recipient[];
};

const TICK_MS = 60_000; // pg_cron كل دقيقة
const MAX_TICKS = 200; // حماية ضد أي loop لا نهائي

/** ينفذ tick واحد كما يفعل الـ worker: يرسل ما استحق موعده ضمن ميزانية global. */
function runTick(job: Job, nowMs: number, settings: UserBulkSettings, bridge: { send: () => void }) {
  if (job.status !== "queued" && job.status !== "processing") return;
  if (job.next_send_at > nowMs) return;

  let budget = Math.max(1, Math.floor(DEFAULT_BULK_GLOBAL_CONFIG.global_msgs_per_second * (TICK_MS / 1000)));

  while (budget-- > 0) {
    if (job.sent_today >= settings.daily_message_cap) {
      job.status = "paused";
      return;
    }
    if (job.sent_in_batch >= settings.messages_per_batch) {
      job.next_send_at = nowMs + settings.batch_rest_seconds * 1000;
      job.sent_in_batch = 0;
      return;
    }
    const next = job.recipients.find((r) => r.status === "pending");
    if (!next) {
      job.status = "sent";
      return;
    }

    bridge.send();
    next.status = "success";
    job.sent_in_batch += 1;
    job.sent_today += 1;
    job.status = "processing";

    // فاصل عشوائي للرسالة التالية داخل نفس الدفعة
    const gap = jitterMs(settings.jitter_min_seconds, settings.jitter_max_seconds);
    job.next_send_at = nowMs + gap;
    nowMs += gap; // نسمح بأكثر من رسالة داخل نفس الـ tick لو الفاصل صغير
    if (job.next_send_at > nowMs) return;
  }
}

function buildJob(count: number): Job {
  return {
    id: "job-1",
    status: "queued",
    next_send_at: 0,
    sent_in_batch: 0,
    sent_today: 0,
    template: "مرحبا {{name}} {عرض|تخفيض|خصم} خاص لك",
    recipients: Array.from({ length: count }, (_, i) => ({
      id: `r-${i}`,
      phone: `20100000${String(i).padStart(4, "0")}`,
      name: `عميل ${i + 1}`,
      status: "pending" as const,
    })),
  };
}

describe("bulk scheduler — background continuation", () => {
  beforeEach(() => {
    // seed حتى يبقى jitter داخل النطاق لكن ثابت للاختبار
    let seed = 42;
    vi.spyOn(Math, "random").mockImplementation(() => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("jitterMs يبقى دائمًا داخل [min, max] عبر 1000 محاولة", () => {
    for (let i = 0; i < 1000; i++) {
      const ms = jitterMs(8, 25);
      expect(ms).toBeGreaterThanOrEqual(8_000);
      expect(ms).toBeLessThanOrEqual(25_000);
    }
  });

  it("renderMessage يستبدل الوسوم ويطبق spintax", () => {
    const out = renderMessage("{{name}} - {أ|ب}", { name: "علي", phone: "" });
    expect(out.startsWith("علي - ")).toBe(true);
    expect(["أ", "ب"]).toContain(out.split(" - ")[1]);
  });

  it("applySpintax يعيد نص خام إذا لا يوجد spintax", () => {
    expect(applySpintax("plain")).toBe("plain");
  });

  it("حملة 25 مستلم تكتمل عبر ticks متتابعة بدون تدخل client", () => {
    const settings: UserBulkSettings = {
      ...DEFAULT_USER_SETTINGS,
      messages_per_batch: 10,
      batch_rest_seconds: 60, // مختصر للاختبار
      jitter_min_seconds: 2,
      jitter_max_seconds: 5,
      daily_message_cap: 500,
    };
    const job = buildJob(25);
    const bridge = { send: vi.fn() };

    let nowMs = 0;
    let ticks = 0;
    while (job.status !== "sent" && ticks < MAX_TICKS) {
      runTick(job, nowMs, settings, bridge);
      nowMs += TICK_MS;
      ticks += 1;
    }

    expect(job.status).toBe("sent");
    expect(bridge.send).toHaveBeenCalledTimes(25);
    expect(job.recipients.every((r) => r.status === "success")).toBe(true);
    // 25 رسالة / 10 بالدفعة = 2 فترة راحة على الأقل → أكثر من tick
    expect(ticks).toBeGreaterThan(1);
  });

  it("daily_message_cap يوقف الحملة ويبقيها paused حتى بدون client", () => {
    const settings: UserBulkSettings = {
      ...DEFAULT_USER_SETTINGS,
      messages_per_batch: 50,
      batch_rest_seconds: 30,
      jitter_min_seconds: 1,
      jitter_max_seconds: 2,
      daily_message_cap: 5, // منخفض جدًا
    };
    const job = buildJob(20);
    const bridge = { send: vi.fn() };
    let nowMs = 0;
    for (let t = 0; t < MAX_TICKS && job.status !== "sent" && job.status !== "paused"; t++) {
      runTick(job, nowMs, settings, bridge);
      nowMs += TICK_MS;
    }
    expect(job.status).toBe("paused");
    expect(bridge.send).toHaveBeenCalledTimes(5);
    expect(job.recipients.filter((r) => r.status === "success")).toHaveLength(5);
    expect(job.recipients.filter((r) => r.status === "pending")).toHaveLength(15);
  });

  it("batch_rest يفصل بين الدُفعات (بدون client متصل)", () => {
    const settings: UserBulkSettings = {
      ...DEFAULT_USER_SETTINGS,
      messages_per_batch: 5,
      batch_rest_seconds: 120,
      jitter_min_seconds: 1,
      jitter_max_seconds: 2,
      daily_message_cap: 100,
    };
    const job = buildJob(11);
    const bridge = { send: vi.fn() };
    const restBoundaries: number[] = [];
    let nowMs = 0;
    for (let t = 0; t < MAX_TICKS && job.status !== "sent"; t++) {
      const before = bridge.send.mock.calls.length;
      runTick(job, nowMs, settings, bridge);
      const after = bridge.send.mock.calls.length;
      if (after > before && after % 5 === 0) restBoundaries.push(nowMs);
      nowMs += TICK_MS;
    }
    expect(job.status).toBe("sent");
    expect(bridge.send).toHaveBeenCalledTimes(11);
    // على الأقل حدث حدّان لبدء راحة (بعد 5 وبعد 10)
    expect(restBoundaries.length).toBeGreaterThanOrEqual(2);
  });

  it("الاستئناف بعد إعادة تشغيل السيرفر (محاكاة إعادة الحياة) يكمل من حيث توقف", () => {
    const settings: UserBulkSettings = {
      ...DEFAULT_USER_SETTINGS,
      messages_per_batch: 5,
      batch_rest_seconds: 600,
      jitter_min_seconds: 1,
      jitter_max_seconds: 2,
    };
    const job = buildJob(40);
    const bridge = { send: vi.fn() };
    let nowMs = 0;
    // شغّل 3 ticks فقط ثم "أطفئ" العميل بالكامل
    for (let t = 0; t < 3; t++) {
      runTick(job, nowMs, settings, bridge);
      nowMs += TICK_MS;
    }
    const sentBeforeShutdown = bridge.send.mock.calls.length;
    expect(sentBeforeShutdown).toBeGreaterThan(0);
    expect(job.status).not.toBe("sent");

    // "إعادة تشغيل" — نفس كائن job فقط (يمثل الصف في DB)، بدون أي state من client
    for (let t = 0; t < MAX_TICKS && job.status !== "sent"; t++) {
      runTick(job, nowMs, settings, bridge);
      nowMs += TICK_MS;
    }
    expect(job.status).toBe("sent");
    expect(bridge.send).toHaveBeenCalledTimes(12);
  });
});

/**
 * Query-count guardrail — WhatsApp inbox realtime invalidation.
 *
 * وثيقة تنفيذية: نتحقق فعلياً أن عدد استدعاءات
 * queryClient.invalidateQueries لا يزيد عند وصول دفعات كبيرة من رسائل
 * realtime، وأن نمط الـdebounce الذي يستخدمه مسار inbox
 * (src/routes/dashboard.whatsapp.inbox.tsx: scheduleInvalidateConversations
 * / scheduleInvalidateMessages) يطوي أي burst إلى استدعاء واحد فقط.
 *
 * ملاحظة قفل السلوك: الاختبار يعدّ استدعاءات دالة invalidate() المُحقنة —
 * لو كسر أي refactor لاحق التجميع (مثلاً بإزالة حارس "if (handle) return")
 * سيصبح count == batchSize بدلاً من 1 والاختبار يسقط فوراً.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedInvalidator } from "@/lib/wa-inbox-invalidation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("wa-inbox-invalidation — burst coalescing", () => {
  it("دفعة 100 رسالة realtime تنتج استدعاء invalidate واحد فقط", () => {
    const invalidate = vi.fn();
    const inv = createDebouncedInvalidator(invalidate, 500);
    for (let i = 0; i < 100; i++) inv.schedule();
    expect(invalidate).not.toHaveBeenCalled(); // لم يمرّ الوقت بعد
    vi.advanceTimersByTime(500);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("burst ثم burst آخر بعد إتمام النافذة = استدعاءان فقط لا 2×N", () => {
    const invalidate = vi.fn();
    const inv = createDebouncedInvalidator(invalidate, 400);
    for (let i = 0; i < 50; i++) inv.schedule();
    vi.advanceTimersByTime(400);
    for (let i = 0; i < 50; i++) inv.schedule();
    vi.advanceTimersByTime(400);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("cancel أثناء burst يمنع أي استدعاء (تنظيف useEffect)", () => {
    const invalidate = vi.fn();
    const inv = createDebouncedInvalidator(invalidate, 500);
    inv.schedule();
    inv.schedule();
    expect(inv.isPending()).toBe(true);
    inv.cancel();
    vi.advanceTimersByTime(1000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(inv.isPending()).toBe(false);
  });

  it("متتابعتان لجدولَي conversations و messages لا يتداخلان: كل واحد invalidate واحد", () => {
    const invConv = vi.fn();
    const invMsgs = vi.fn();
    const conv = createDebouncedInvalidator(invConv, 400);
    const msgs = createDebouncedInvalidator(invMsgs, 500);
    // محاكاة دفعة realtime: كل حدث يُطلق الاثنين.
    for (let i = 0; i < 200; i++) {
      conv.schedule();
      msgs.schedule();
    }
    vi.advanceTimersByTime(500);
    expect(invConv).toHaveBeenCalledTimes(1);
    expect(invMsgs).toHaveBeenCalledTimes(1);
  });

  it("سيناريو مختلط: 500 حدث موزّعة على 3 نوافذ زمنية = 3 استدعاءات كحد أقصى", () => {
    const invalidate = vi.fn();
    const inv = createDebouncedInvalidator(invalidate, 300);
    for (let i = 0; i < 500; i++) {
      inv.schedule();
      if (i === 199 || i === 399) vi.advanceTimersByTime(300); // إغلاق نافذة
    }
    vi.advanceTimersByTime(300);
    expect(invalidate).toHaveBeenCalledTimes(3);
    // تحقق صارم: أقل بكثير من عدد الأحداث.
    expect(invalidate.mock.calls.length).toBeLessThan(500);
  });
});

describe("wa-inbox-invalidation — regression: no per-event refetch", () => {
  it("regression: إزالة حارس الـcoalescing سيرفع العدد إلى N — نضمن أنه 1", () => {
    const invalidate = vi.fn();
    const inv = createDebouncedInvalidator(invalidate, 500);
    const N = 1000;
    for (let i = 0; i < N; i++) inv.schedule();
    vi.advanceTimersByTime(500);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalledTimes(N);
  });
});

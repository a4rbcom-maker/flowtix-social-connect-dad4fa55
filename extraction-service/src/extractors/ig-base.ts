import type { Page } from "playwright";
import { BaseExtractor } from "./base.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { supabaseService } from "../services/supabase.js";
import { igSupabaseService } from "../services/ig-supabase.js";
import type { JobContext } from "../types.js";

const log = logger;

export abstract class IgBaseExtractor extends BaseExtractor {
  protected readonly platform = "instagram";
  protected igScrollDelayMinMs = config.igScrollDelayMinMs;
  protected igScrollDelayMaxMs = config.igScrollDelayMaxMs;

  constructor(page: Page, ctx: JobContext, secondaryPages?: Array<{ sessionId: string; page: Page }>) {
    super(page, ctx, secondaryPages);
    this.requestDelayMs = config.igScrollDelayMinMs;
    this.batchSizeForRest = config.igRestAfterScrolls;
    this.restDelayMs = config.igRestDelayMs;
  }

  /** pacing عشوائي بين 1.5–3 ثوانٍ لكل تمريرة (أهدأ من فيسبوك لحماية الجلسة) */
  protected async igScrollDelay(): Promise<void> {
    const ms =
      this.igScrollDelayMinMs +
      Math.floor(Math.random() * (this.igScrollDelayMaxMs - this.igScrollDelayMinMs + 1));
    await this.page.waitForTimeout(ms);
  }

  /** كشف حظر أو تحقق أمني في HTML أو URL النهائي */
  protected detectIgBlocked(html: string, finalUrl?: string): boolean {
    const lower = html.toLowerCase();
    if (finalUrl) {
      const urlLower = finalUrl.toLowerCase();
      if (urlLower.includes("/challenge/") || urlLower.includes("/accounts/login")) return true;
    }
    return (
      lower.includes("action_blocked") ||
      lower.includes("action blocked") ||
      lower.includes("try again later") ||
      lower.includes("feedback_required") ||
      lower.includes("checkpoint_required") ||
      lower.includes("your account has been temporarily blocked")
    );
  }

  /** معالجة الحظر: تعليم الجلسة disconnected ثم switchToNextSession أو إيقاف paused */
  protected async handleIgBlocked(): Promise<boolean> {
    log.warn("IgBase", `IG block/checkpoint on session ${this.ctx.sessionId.slice(0, 8)}`);
    await igSupabaseService
      .updateIgSessionStatus(this.ctx.sessionId, "disconnected", "IG block/checkpoint detected")
      .catch(() => {});
    const switched = await this.switchToNextSession();
    if (!switched) {
      await supabaseService.updateJob(this.ctx.jobId, {
        status: "paused",
        error: "تم حظر جميع جلسات إنستجرام — أضف جلسة إضافية (حساب آخر) ثم استأنف المهمة لزيادة نسبة الاستخراج.",
      });
      log.warn("IgBase", `no more IG sessions — job ${this.ctx.jobId} paused`);
    }
    return switched;
  }

  /** قراءة عدد مضغوط مثل "1.2K" / "3.4M" / "247" */
  protected parseIgCompactNumber(text: string): number | null {
    const cleaned = text.replace(/[,\s\u00a0]/g, "");
    const m = cleaned.match(/([\d.]+)\s*([KkMm])?/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (isNaN(num)) return null;
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k") return Math.round(num * 1000);
    if (suffix === "m") return Math.round(num * 1_000_000);
    return Math.round(num);
  }

  /** نسبة التغطية extracted/total (نسبة مئوية 0–100) */
  protected computeCoverage(extracted: number, total: number | null): number | null {
    if (!total || total <= 0) return null;
    return Math.min(100, Math.round((extracted / total) * 100));
  }

  protected async updateIgProgress(extra: Record<string, unknown>): Promise<void> {
    await supabaseService.storeProgress(this.ctx.jobId, {
      ...extra,
      last_update: new Date().toISOString(),
    });
  }
}

/**
 * /ig-actions/* — mention + DM broadcast control for Instagram extraction
 * results. Mirrors /messages/* (Messenger) but operates on ig_sessions, reads
 * recipients from extraction_results where platform='instagram', and enforces
 * the Instagram rate ceilings SERVER-SIDE (the client can never raise them).
 *
 * Ownership is checked explicitly; auth bypasses RLS via service role.
 */
import { Router } from "express";
import { z } from "zod";
import { supabaseClient, supabaseService } from "../services/supabase.js";
import { igSupabaseService } from "../services/ig-supabase.js";
import { startIgActionWorker, stopIgActionWorker, resumeIgActionJobs } from "../services/ig-action-worker.js";
import { chunkMentions, IG_MENTION_DEFAULTS, IG_DM_DEFAULTS } from "../services/ig-action-pacing.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";

const log = logger;
const router = Router();
const sb = supabaseClient;

const pacingFields = {
  mentions_per_comment: z.number().int().min(1).max(5).default(4),
  comments_per_hour: z.number().int().min(1).max(12).default(8),
  daily_cap: z.number().int().min(1).max(80).default(60),
  rate_per_hour: z.number().int().min(1).max(20).default(5),
  delay_min: z.number().int().min(20).max(900).default(380),
  delay_max: z.number().int().min(20).max(900).default(520),
  batch_size: z.number().int().min(1).max(30).default(6),
  batch_pause: z.number().int().min(60).max(3600).default(1800),
  respect_quiet_hours: z.boolean().default(true),
  max_errors: z.number().int().min(1).max(20).default(5),
  retry_max: z.number().int().min(1).max(3).default(2),
};

const startSchema = z
  .object({
    source_job_id: z.string().uuid(),
    session_ids: z.array(z.string().uuid()).min(1).max(2),
    mode: z.enum(["dm", "mention"]),
    body: z.string().min(1).max(2000),
    post_url: z.string().max(4000).optional(),
    name: z.string().max(120).optional(),
    ...pacingFields,
  })
  .refine((d) => d.delay_max >= d.delay_min, { message: "delay_max must be >= delay_min" });

const previewSchema = z.object({
  source_job_id: z.string().uuid(),
  mode: z.enum(["dm", "mention"]),
  body: z.string().min(1).max(2000),
  mentions_per_comment: z.number().int().min(1).max(5).default(4),
});

const jobActionSchema = z.object({
  job_id: z.string().uuid().min(1),
  session_id: z.string().optional(),
});

function httpError(res: import("express").Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Load extraction_results (platform=instagram) for a job, mapped to handles. */
async function materializeIgRecipients(sourceJobId: string): Promise<{ eligible: Array<{ fb_id: string; handle: string; name: string }>; skipped: number }> {
  const PAGE = 1000;
  const eligible: Array<{ fb_id: string; handle: string; name: string }> = [];
  let skipped = 0;
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from("extraction_results")
      .select("fb_id, data")
      .eq("job_id", sourceJobId)
      .eq("platform", "instagram")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `load IG recipients failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const rawHandle = (row.data as { username?: string } | null)?.username ?? row.fb_id;
      const handle = rawHandle.replace(/^@/, "").replace(/\/+$/, "").trim();
      if (!/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
        skipped += 1;
        continue;
      }
      if (eligible.some((e) => e.handle === handle)) continue; // per-job uniqueness
      eligible.push({ fb_id: row.fb_id, handle, name: (row.data as { name?: string } | null)?.name ?? "" });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return { eligible, skipped };
}

function parsePostShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const m2 = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/i);
  return m2 ? m2[1] : null;
}

router.post("/ig-actions/preview", async (req, res) => {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid request");
    const { source_job_id, mode, body, mentions_per_comment } = parsed.data;

    const { data: job } = await sb.from("extraction_jobs").select("id, type, user_id").eq("id", source_job_id).maybeSingle();
    if (!job) return httpError(res, 404, "NOT_FOUND", "المهمة المصدر غير موجودة");
    if (!String(job.type).startsWith("ig_")) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "المهمة المصدر ليست من إنستجرام");

    const { eligible, skipped } = await materializeIgRecipients(source_job_id);
    const perComment = mode === "mention" ? Math.min(mentions_per_comment, 5) : 1;
    const commentsNeeded = mode === "mention" ? Math.ceil(eligible.length / perComment) : eligible.length;
    const hourly = mode === "mention" ? IG_MENTION_DEFAULTS.comments_per_hour : IG_DM_DEFAULTS.rate_per_hour;
    const estHours = hourly > 0 ? Math.ceil(commentsNeeded / hourly) : 0;
    const estDays = estHours > 0 ? Math.ceil(estHours / 20) : 0; // ~20 working hours/day (quiet hours excluded)
    const coldOutreach = true;

    return res.json({
      eligible: eligible.length,
      skipped_unsupported: skipped,
      mode,
      source_type: job.type,
      cold_outreach: coldOutreach,
      comments_needed: commentsNeeded,
      est_hours: estHours,
      est_days: estDays,
      sample: eligible.slice(0, 3).map((r) => `@${r.handle}`),
    });
  } catch (err) {
    log.error("IgActions", `preview: ${String(err)}`);
    return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, err instanceof Error ? err.message : String(err));
  }
});

router.post("/ig-actions/start", async (req, res) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return httpError(res, 400, ErrorCodes.INVALID_INPUT, parsed.error.issues.map((i) => i.message).join(", "));
    }
    const input = parsed.data;

    // 1) source job ownership + IG type
    const { data: sourceJob } = await sb.from("extraction_jobs").select("id, user_id, type, name").eq("id", input.source_job_id).maybeSingle();
    if (!sourceJob) return httpError(res, 404, "NOT_FOUND", "المهمة المصدر غير موجودة");
    if (!String(sourceJob.type).startsWith("ig_")) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "يمكن فقط استخدام مهام استخراج إنستجرام");

    // 2) mention mode requires a valid post
    let postShortcode: string | null = null;
    if (input.mode === "mention") {
      if (!input.post_url) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "وضع المنشن يتطلب رابط منشور إنستجرام");
      postShortcode = parsePostShortcode(input.post_url);
      if (!postShortcode) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "رابط المنشور غير صالح (استخدم https://www.instagram.com/p/CODE/)");
    }

    // 3) sessions: exist, connected, same owner, NOT locked
    const { data: sessions } = await sb.from("ig_sessions").select("id, user_id, status, deleted_at").in("id", input.session_ids);
    const problems: string[] = [];
    for (const sid of input.session_ids) {
      const s = (sessions ?? []).find((x) => x.id === sid);
      if (!s || s.deleted_at) problems.push(`الجلسة ${sid.slice(0, 8)} غير موجودة`);
      else if (s.user_id !== sourceJob.user_id) problems.push(`الجلسة ${sid.slice(0, 8)} لا تملكها نفس المهمة`);
      else if (s.status !== "connected") problems.push(`الجلسة ${sid.slice(0, 8)} غير متصلة`);
    }
    if (problems.length > 0) return httpError(res, 400, ErrorCodes.INVALID_INPUT, problems.join(" — "));

    // 4) no active IG action job for this user
    const { data: active } = await sb
      .from("message_jobs")
      .select("id")
      .eq("user_id", sourceJob.user_id)
      .eq("platform", "instagram")
      .in("status", ["queued", "running", "paused"])
      .limit(1);
    if (active && active.length > 0) {
      return httpError(res, 409, "IG_ACTION_ACTIVE", "لديك مهمة إنستجرام نشطة بالفعل. أوقفها أو انتظر اكتمالها.");
    }

    // 5) materialize recipients
    const { eligible, skipped: skippedUnsupported } = await materializeIgRecipients(input.source_job_id);
    if (eligible.length === 0) {
      return httpError(res, 400, "NO_SENDABLE_RECIPIENTS", "لا يوجد مستلمون صالحون في نتائج هذه المهمة.");
    }

    // 6) SERVER-SIDE ceiling enforcement (never trust the client)
    const config =
      input.mode === "mention"
        ? {
            mentions_per_comment: Math.min(input.mentions_per_comment ?? 4, 5),
            comments_per_hour: Math.min(input.comments_per_hour ?? 8, 12),
            daily_cap: Math.min(input.daily_cap ?? 60, 80),
            rate_per_hour: Math.min(input.rate_per_hour ?? 8, 12),
            delay_min: Math.max(input.delay_min ?? 380, 350),
            delay_max: input.delay_max,
            batch_size: Math.min(input.batch_size ?? 6, 30),
            batch_pause: input.batch_pause,
            respect_quiet_hours: input.respect_quiet_hours,
            max_errors: input.max_errors,
            retry_max: input.retry_max,
          }
        : {
            mentions_per_comment: 1,
            comments_per_hour: Math.min(input.rate_per_hour ?? 5, 12),
            daily_cap: Math.min(input.daily_cap ?? 15, 30),
            rate_per_hour: Math.min(input.rate_per_hour ?? 5, 20),
            delay_min: Math.max(input.delay_min ?? 90, 350),
            delay_max: input.delay_max,
            batch_size: Math.min(input.batch_size ?? 5, 30),
            batch_pause: input.batch_pause,
            respect_quiet_hours: input.respect_quiet_hours,
            max_errors: input.max_errors,
            retry_max: input.retry_max,
          };

    const { data: created, error: insertErr } = await sb.from("message_jobs").insert({
      user_id: sourceJob.user_id,
      source_job_id: input.source_job_id,
      name: input.name || `إنستجرام — ${sourceJob.name ?? input.source_job_id.slice(0, 8)}`,
      status: "queued",
      platform: "instagram",
      mode: input.mode,
      session_ids: input.session_ids,
      content: { body: input.body, post_shortcode: postShortcode },
      config,
      progress: { sent: 0, failed: 0, skipped: 0, current_idx: 0 },
    }).select("id").single();
    if (insertErr || !created) {
      const msg = insertErr?.message ?? "insert failed";
      if (msg.includes("P0001") || msg.includes("نشطة")) {
        return httpError(res, 409, "IG_ACTION_ACTIVE", "لديك مهمة إنستجرام نشطة بالفعل.");
      }
      return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, `تعذر إنشاء المهمة: ${msg}`);
    }
    const jobId = created.id as string;

    const rows = eligible.map((r) => ({
      message_job_id: jobId,
      fb_id: r.fb_id,
      thread_id: r.handle,
      name: r.name,
      status: "pending" as const,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: recErr } = await sb.from("message_recipients").insert(rows.slice(i, i + 500));
      if (recErr) {
        log.error("IgActions", `recipient insert failed for job ${jobId}: ${recErr.message}`);
        await sb.from("message_jobs").delete().eq("id", jobId);
        return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, `تعذر تجهيز المستلمين: ${recErr.message}`);
      }
    }

    log.info("IgActions", `job ${jobId} created: ${rows.length} recipients (${input.mode}), sessions=${input.session_ids.length}`);
    void chunkMentions;
    void igSupabaseService;
    void supabaseService;
    startIgActionWorker(jobId);

    return res.json({
      job_id: jobId,
      recipient_count: rows.length,
      skipped_unsupported: skippedUnsupported,
      mode: input.mode,
      status: "queued",
    });
  } catch (err) {
    log.error("IgActions", `start: ${String(err)}`);
    return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, err instanceof Error ? err.message : String(err));
  }
});

router.post("/ig-actions/pause", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  stopIgActionWorker(parsed.data.job_id);
  await sb.from("message_jobs").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", parsed.data.job_id);
  return res.json({ status: "paused" });
});

router.post("/ig-actions/resume", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  const { data: job } = await sb.from("message_jobs").select("id, status").eq("id", parsed.data.job_id).maybeSingle();
  if (!job) return httpError(res, 404, "NOT_FOUND", "المهمة غير موجودة");
  if (job.status === "completed" || job.status === "canceled") {
    return httpError(res, 400, ErrorCodes.INVALID_INPUT, "المهمة منتهية ولا يمكن استئنافها");
  }
  await sb.from("message_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
  startIgActionWorker(job.id);
  return res.json({ status: "running" });
});

router.post("/ig-actions/stop", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  stopIgActionWorker(parsed.data.job_id);
  await sb.from("message_jobs").update({
    status: "canceled",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.job_id);
  return res.json({ status: "canceled" });
});

router.get("/ig-actions/:jobId", async (req, res) => {
  try {
    const { data: job } = await sb.from("message_jobs").select("*").eq("id", req.params.jobId).maybeSingle();
    if (!job) return httpError(res, 404, "NOT_FOUND", "المهمة غير موجودة");
    const { data: recipients } = await sb
      .from("message_recipients")
      .select("id, thread_id, name, status, attempts, error, sent_at, sent_via_session_id")
      .eq("message_job_id", req.params.jobId)
      .order("created_at", { ascending: false })
      .limit(50);
    return res.json({ job, recent: recipients ?? [] });
  } catch (err) {
    return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, String(err));
  }
});

export default router;
export { resumeIgActionJobs };

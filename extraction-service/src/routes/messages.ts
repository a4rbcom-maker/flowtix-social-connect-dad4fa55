/**
 * /messages/* — broadcast control API mirroring /publish/*.
 * Ownership checks are explicit (service-role bypasses RLS).
 */
import { Router } from "express";
import { z } from "zod";
import { supabaseClient, supabaseService } from "../services/supabase.js";
import { startMessageWorker, stopMessageWorker, resumeMessageJobs } from "../services/message-worker.js";
import { renderTemplate, hasVariation, normalizeThreadId } from "../services/message-pacing.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";

const log = logger;
const router = Router();
const sb = supabaseClient;

const pacingFields = {
  daily_cap: z.number().int().min(1).max(80).default(40),
  rate_per_hour: z.number().int().min(1).max(20).default(12),
  delay_min: z.number().int().min(20).max(600).default(45),
  delay_max: z.number().int().min(20).max(600).default(150),
  batch_size: z.number().int().min(1).max(30).default(8),
  batch_pause: z.number().int().min(60).max(3600).default(900),
  max_errors: z.number().int().min(1).max(20).default(5),
  retry_max: z.number().int().min(1).max(3).default(2),
};

const startSchema = z.object({
  source_job_id: z.string().uuid(),
  session_ids: z.array(z.string().uuid()).min(1).max(2),
  name: z.string().max(120).optional(),
  body: z.string().min(1).max(2000),
  media_keys: z.array(z.string()).max(4).default([]),
  ...pacingFields,
  /** Test escape hatch: cap materialized recipients (never exposed in UI). */
  max_recipients: z.number().int().min(1).max(100000).optional(),
}).refine((d) => d.delay_max >= d.delay_min, { message: "delay_max must be >= delay_min" });

const previewSchema = z.object({
  source_job_id: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

const jobActionSchema = z.object({
  job_id: z.string().uuid().min(1),
  session_id: z.string().optional(),
});

function httpError(res: import("express").Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Load extraction_results for a job, mapped to eligible recipients. */
async function materializeRecipients(sourceJobId: string): Promise<{ eligible: Array<{ fb_id: string; thread_id: string; name: string }>; skippedUnsupported: number }> {
  const PAGE = 1000;
  const eligible: Array<{ fb_id: string; thread_id: string; name: string }> = [];
  let skipped = 0;
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from("extraction_results")
      .select("fb_id, data")
      .eq("job_id", sourceJobId)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `load recipients failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const threadId = normalizeThreadId(row.fb_id);
      if (!threadId) { skipped += 1; continue; }
      const dedupeKey = threadId;
      if (eligible.some((e) => e.thread_id === dedupeKey)) continue;
      eligible.push({ fb_id: row.fb_id, thread_id: threadId, name: (row.data as { name?: string })?.name ?? "" });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return { eligible, skippedUnsupported: skipped };
}

router.post("/messages/preview", async (req, res) => {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid request");
    const { source_job_id, body } = parsed.data;

    const { data: job } = await sb.from("extraction_jobs").select("id, type, user_id").eq("id", source_job_id).maybeSingle();
    if (!job) return httpError(res, 404, "NOT_FOUND", "المهمة المصدر غير موجودة");

    const { eligible, skippedUnsupported } = await materializeRecipients(source_job_id);
    const samples = eligible.slice(0, 3).map((r) => renderTemplate(body, { name: r.name }));
    const estDays = eligible.length > 0 ? Math.ceil(eligible.length / Math.max(1, 40)) : 0;

    return res.json({
      eligible: eligible.length,
      skipped_unsupported: skippedUnsupported,
      source_type: job.type,
      has_variation: hasVariation(body),
      est_days: estDays,
      sample: samples,
    });
  } catch (err) {
    log.error("Messages", `preview: ${String(err)}`);
    return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, err instanceof Error ? err.message : String(err));
  }
});

router.post("/messages/start", async (req, res) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return httpError(res, 400, ErrorCodes.INVALID_INPUT, parsed.error.issues.map((i) => i.message).join(", "));
    }
    const input = parsed.data;

    // 1) source job ownership + platform
    const { data: sourceJob } = await sb.from("extraction_jobs").select("id, user_id, type, name").eq("id", input.source_job_id).maybeSingle();
    if (!sourceJob) return httpError(res, 404, "NOT_FOUND", "المهمة المصدر غير موجودة");

    // 2) sessions: exist, connected, same owner
    const { data: sessions } = await sb.from("fb_sessions").select("id, user_id, status, deleted_at").in("id", input.session_ids);
    const problems: string[] = [];
    for (const sid of input.session_ids) {
      const s = (sessions ?? []).find((x) => x.id === sid);
      if (!s || s.deleted_at) problems.push(`الجلسة ${sid.slice(0, 8)} غير موجودة`);
      else if (s.user_id !== sourceJob.user_id) problems.push(`الجلسة ${sid.slice(0, 8)} لا تملكها نفس المهمة`);
      else if (s.status !== "connected") problems.push(`الجلسة ${sid.slice(0, 8)} غير متصلة`);
    }
    if (problems.length > 0) return httpError(res, 400, ErrorCodes.INVALID_INPUT, problems.join(" — "));

    // 3) no active message job for this user (DB trigger is the last line; we pre-check for a clean 409)
    const { data: active } = await sb.from("message_jobs").select("id").eq("user_id", sourceJob.user_id).in("status", ["queued", "running", "paused"]).limit(1);
    if (active && active.length > 0) {
      return httpError(res, 409, "MESSAGE_JOB_ACTIVE", "لديك مهمة مراسلة نشطة بالفعل. أوقفها أو انتظر اكتمالها.");
    }

    // 4) materialize recipients
    const { eligible, skippedUnsupported } = await materializeRecipients(input.source_job_id);
    if (eligible.length === 0) {
      return httpError(res, 400, "NO_SENDABLE_RECIPIENTS", "لا يوجد مستلمون صالحون في نتائج هذه المهمة.");
    }

    const coldOutreach = sourceJob.type !== "messenger_contacts";
    const config = {
      daily_cap: input.daily_cap,
      rate_per_hour: input.rate_per_hour,
      delay_min: input.delay_min,
      delay_max: input.delay_max,
      batch_size: input.batch_size,
      batch_pause: input.batch_pause,
      max_errors: input.max_errors,
      retry_max: input.retry_max,
    };

    const { data: created, error: insertErr } = await sb.from("message_jobs").insert({
      user_id: sourceJob.user_id,
      source_job_id: input.source_job_id,
      name: input.name || `مراسلة — ${sourceJob.name ?? input.source_job_id.slice(0, 8)}`,
      status: "queued",
      session_ids: input.session_ids,
      content: { body: input.body, media_keys: input.media_keys },
      config,
      progress: { sent: 0, failed: 0, skipped: 0, current_idx: 0 },
    }).select("id").single();
    if (insertErr || !created) {
      const msg = insertErr?.message ?? "insert failed";
      if (msg.includes("P0001") || msg.includes("مراسلة نشطة")) {
        return httpError(res, 409, "MESSAGE_JOB_ACTIVE", "لديك مهمة مراسلة نشطة بالفعل.");
      }
      return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, `تعذر إنشاء المهمة: ${msg}`);
    }
    const jobId = created.id as string;

    const all = eligible.map((r) => ({
      message_job_id: jobId,
      fb_id: r.fb_id,
      thread_id: r.thread_id,
      name: r.name,
      status: "pending" as const,
    }));
    const rows = input.max_recipients ? all.slice(0, input.max_recipients) : all;
    for (let i = 0; i < rows.length; i += 500) {
      const { error: recErr } = await sb.from("message_recipients").insert(rows.slice(i, i + 500));
      if (recErr) {
        log.error("Messages", `recipient insert failed for job ${jobId}: ${recErr.message}`);
        await sb.from("message_jobs").delete().eq("id", jobId);
        return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, `تعذر تجهيز المستلمين: ${recErr.message}`);
      }
    }

    log.info("Messages", `job ${jobId} created: ${rows.length} recipients, ${skippedUnsupported} unsupported, sessions=${input.session_ids.length}, cold=${coldOutreach}`);
    startMessageWorker(jobId);

    return res.json({
      job_id: jobId,
      recipient_count: rows.length,
      skipped_unsupported: skippedUnsupported,
      cold_outreach: coldOutreach,
      status: "queued",
    });
  } catch (err) {
    log.error("Messages", `start: ${String(err)}`);
    return httpError(res, 500, ErrorCodes.UNKNOWN_ERROR, err instanceof Error ? err.message : String(err));
  }
});

router.post("/messages/pause", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  stopMessageWorker(parsed.data.job_id);
  await sb.from("message_jobs").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", parsed.data.job_id);
  return res.json({ status: "paused" });
});

router.post("/messages/resume", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  const { data: job } = await sb.from("message_jobs").select("id, status, session_ids").eq("id", parsed.data.job_id).maybeSingle();
  if (!job) return httpError(res, 404, "NOT_FOUND", "المهمة غير موجودة");
  if (job.status === "completed" || job.status === "canceled") {
    return httpError(res, 400, ErrorCodes.INVALID_INPUT, "المهمة منتهية ولا يمكن استئنافها");
  }
  await sb.from("message_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job.id);
  startMessageWorker(job.id);
  return res.json({ status: "running" });
});

router.post("/messages/stop", async (req, res) => {
  const parsed = jobActionSchema.safeParse(req.body);
  if (!parsed.success) return httpError(res, 400, ErrorCodes.INVALID_INPUT, "Invalid input");
  stopMessageWorker(parsed.data.job_id);
  await sb.from("message_jobs").update({
    status: "canceled",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.job_id);
  return res.json({ status: "canceled" });
});

router.get("/messages/:jobId", async (req, res) => {
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
export { resumeMessageJobs };

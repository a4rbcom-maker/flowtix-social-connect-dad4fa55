import { Router } from "express";
import { z } from "zod";
import { supabaseService, supabaseClient } from "../services/supabase.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { startPublishWorker, stopPublishWorker, isJobRunningHere, resumePublishJobs } from "../services/publish-worker.js";

const log = logger;
const router = Router();
const sb = supabaseClient;

const startSchema = z.object({
  session_id: z.string().min(1),
  name: z.string().optional(),
  message: z.string().min(1),
  group_ids: z.array(z.string()).min(1),
  delay_min: z.number().int().min(10).max(600).default(60),
  delay_max: z.number().int().min(10).max(600).default(180),
  max_retries: z.number().int().min(1).max(5).default(3),
  skip_restricted: z.boolean().default(true),
  max_errors: z.number().int().min(3).max(20).default(10),
  batch_size: z.number().int().min(1).max(50).default(5),
  batch_pause: z.number().int().min(30).max(3600).default(600),
  // Photo/video attachments. Images and videos can't be mixed in one Facebook
  // post, so the client sends one media kind per job.
  media_urls: z.array(z.string().url()).max(10).default([]),
});

const jobActionSchema = z.object({
  job_id: z.string().min(1),
  // Optional: pause/stop don't need a session; resume prefers the session
  // recorded on the job row and only falls back to this.
  session_id: z.string().min(1).optional(),
});

router.post("/publish/start", async (req, res) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(", ") });

    const { session_id, name, message, group_ids, delay_min, delay_max, max_retries, skip_restricted, max_errors, batch_size, batch_pause, media_urls } = parsed.data;

    const { session } = await supabaseService.getSessionAndCookies(session_id);

    // Session must actually be connected before we queue a publish job.
    if (session.status !== "connected") {
      return res.status(409).json({ error: { code: ErrorCodes.SESSION_NOT_CONNECTED, message: "الجلسة غير متصلة — أعد ربط الجلسة قبل النشر" } });
    }

    const { data: existing } = await sb.from("publish_jobs").select("id").eq("user_id", session.user_id).in("status", ["running", "queued"]).limit(1);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: { code: ErrorCodes.JOB_ALREADY_ACTIVE, message: "لديك مهمة نشر نشطة بالفعل" } });
    }

    // publish_jobs.workspace_id is NOT NULL, and sessions can carry a null
    // workspace. Post-workspaces design (migration 2026072716 dropped the
    // `workspaces` table; 2026082902 scopes workspace_id to the user's own id)
    // means the user id IS the workspace — never look the table up.
    const workspaceId = (session.workspace_id as string | null) ?? session.user_id;
    if (!workspaceId) {
      log.error("Publish", `session ${session_id.slice(0, 8)} has neither workspace_id nor user_id`);
      return res.status(500).json({
        error: { code: ErrorCodes.UNKNOWN_ERROR, message: "تعذّر تحديد مساحة العمل لهذه الجلسة — أعد ربط الجلسة" },
      });
    }

    const { data: inserted, error: insertErr } = await sb.from("publish_jobs").insert({
      workspace_id: workspaceId,
      user_id: session.user_id,
      session_id,
      name: name || "نشر جماعي",
      status: "running",
      config: { message, group_ids, delay_min, delay_max, max_retries, skip_restricted, max_errors, batch_size, batch_pause, media_urls },
    }).select("id").single();
    const jobId = inserted?.id;
    if (!jobId) {
      // Surface the real cause instead of a generic failure string.
      const detail = insertErr?.message ?? "unknown database error";
      log.error("Publish", `job insert failed: ${detail}`);
      const friendly = /null value in column "workspace_id"/i.test(detail)
        ? "تعذّر ربط المهمة بمساحة عمل — أعد المحاولة أو تواصل مع الدعم"
        : /publish_jobs_status_check/i.test(detail)
          ? "حالة المهمة غير صالحة"
          : "فشل إنشاء مهمة النشر — أعد المحاولة";
      return res.status(500).json({ error: { code: ErrorCodes.UNKNOWN_ERROR, message: friendly, detail } });
    }
    log.info("Publish", `job created: ${jobId}`);

    startPublishWorker(jobId, session_id);
    return res.json({ job_id: jobId, status: "running" });
  } catch (err) {
    log.error("Publish", `start error: ${String(err)}`);
    return res.status(500).json({ error: { code: ErrorCodes.UNKNOWN_ERROR, message: String(err) } });
  }
});

router.post("/publish/pause", async (req, res) => {
  try {
    const parsed = jobActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const { job_id } = parsed.data;
    stopPublishWorker(job_id);
    // Only pause if still owned by a running worker here; never clobber canceled/completed.
    await sb.from("publish_jobs").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", job_id).in("status", ["running", "queued"]);
    return res.json({ status: "paused" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.post("/publish/resume", async (req, res) => {
  try {
    const parsed = jobActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const { job_id, session_id } = parsed.data;

    if (isJobRunningHere(job_id)) {
      return res.status(409).json({ error: { code: ErrorCodes.JOB_ALREADY_ACTIVE, message: "المهمة تعمل حاليًا" } });
    }

    const { data: rows } = await sb.from("publish_jobs").select("status, session_id").eq("id", job_id).limit(1);
    const job = rows?.[0];
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status === "canceled") return res.status(409).json({ error: { code: ErrorCodes.JOB_ALREADY_ACTIVE, message: "المهمة ملغاة ولا يمكن استئنافها" } });
    // Prefer the session recorded on the job; fall back to the request body.
    const sid = job.session_id || session_id;
    const { session } = await supabaseService.getSessionAndCookies(sid);
    if (session.status !== "connected") {
      return res.status(409).json({ error: { code: ErrorCodes.SESSION_NOT_CONNECTED, message: "الجلسة غير متصلة — أعد ربط الجلسة قبل الاستئناف" } });
    }

    const { error: upErr } = await sb.from("publish_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job_id).in("status", ["paused", "completed"]);
    if (upErr) return res.status(500).json({ error: String(upErr) });
    startPublishWorker(job_id, sid);
    return res.json({ status: "running" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.post("/publish/stop", async (req, res) => {
  try {
    const parsed = jobActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
    const { job_id } = parsed.data;
    stopPublishWorker(job_id);
    // Unconditional: stop must win over whatever the worker writes next.
    await sb.from("publish_jobs").update({ status: "canceled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job_id);
    return res.json({ status: "canceled" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
export { resumePublishJobs };

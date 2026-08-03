import { Router } from "express";
import { z } from "zod";
import { supabaseService, supabaseClient } from "../services/supabase.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { startPublishWorker, stopPublishWorker } from "../services/publish-worker.js";

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
});

const jobActionSchema = z.object({
  job_id: z.string().min(1),
  session_id: z.string().min(1),
});

router.post("/publish/start", async (req, res) => {
  try {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(", ") });

    const { session_id, name, message, group_ids, delay_min, delay_max, max_retries, skip_restricted, max_errors, batch_size, batch_pause } = parsed.data;

    const { session } = await supabaseService.getSessionAndCookies(session_id);

    const { data: existing } = await sb.from("publish_jobs").select("id").eq("user_id", session.user_id).in("status", ["running","paused","queued"]).limit(1);
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: { code: ErrorCodes.JOB_ALREADY_ACTIVE, message: "لديك مهمة نشر نشطة بالفعل" } });
    }

    const { data: inserted } = await sb.from("publish_jobs").insert({
      workspace_id: session.workspace_id,
      user_id: session.user_id,
      session_id,
      name: name || "نشر جماعي",
      status: "queued",
      config: { message, group_ids, delay_min, delay_max, max_retries, skip_restricted, max_errors, batch_size, batch_pause },
    }).select("id").single();
    const jobId = inserted?.id;
    if (!jobId) return res.status(500).json({ error: { code: ErrorCodes.UNKNOWN_ERROR, message: "Failed to create publish job" } });
    log.info("Publish", `job created: ${jobId}`);

    startPublishWorker(jobId, session_id);
    return res.json({ job_id: jobId, status: "queued" });
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
    await stopPublishWorker(job_id);
    await sb.from("publish_jobs").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", job_id);
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
    await sb.from("publish_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", job_id);
    startPublishWorker(job_id, session_id);
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
    await stopPublishWorker(job_id);
    await sb.from("publish_jobs").update({ status: "canceled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job_id);
    return res.json({ status: "canceled" });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;

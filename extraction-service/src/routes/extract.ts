import { Router } from "express";
import { z } from "zod";
import * as XLSX from "xlsx";
import { supabaseService } from "../services/supabase.js";
import { igSupabaseService } from "../services/ig-supabase.js";
import { enrichmentService } from "../services/enrichment-service.js";
import { contextManager } from "../services/context-manager.js";
import { igContextManager } from "../services/ig-context-manager.js";
import { jobQueue } from "../services/job-queue.js";
import { createExtractor } from "../extractors/index.js";
import { detectAuthState, authStateToMessage, authStateToErrorCode } from "../extractors/base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import type { ExtractionType, JobContext } from "../types.js";

const log = logger;
const router = Router();

const extractSchema = z.object({
  session_id: z.string().optional(),
  session_ids: z.array(z.string()).optional(),
  type: z.enum([
    "groups",
    "pages",
    "post_comments",
    "post_reactions",
    "messenger_contacts",
    "ig_followers",
    "ig_following",
    "ig_post_commenters",
    "ig_hashtag_posts",
    "ig_profile_info",
  ]),
  source_url: z.string().min(1),
  job_name: z.string().optional(),
  max_results: z.number().int().min(1).max(100000).default(100000),
  skip_duplicates: z.boolean().default(true),
  cursor: z.string().optional(),
  job_id: z.string().optional(),
}).refine(data => data.session_id || (data.session_ids && data.session_ids.length > 0), {
  message: "Either session_id or session_ids must be provided",
});

function isIgType(type: string): boolean {
  return type.startsWith("ig_");
}

async function autoStartNextQueuedJob(userId: string): Promise<void> {
  const qJob = await supabaseService.getOldestQueuedJob(userId);
  if (!qJob) return;
  const qConfig = (qJob.config || {}) as Record<string, unknown>;
  const sessionIds = (qConfig.session_ids as string[]) || [qConfig.session_id as string].filter(Boolean);
  if (!sessionIds || sessionIds.length === 0) {
    log.warn("Extract", `queued job ${qJob.id} missing session_ids`);
    await supabaseService.failJob(qJob.id, "Queued job missing session_ids");
    await autoStartNextQueuedJob(userId);
    return;
  }
  log.info("Extract", `auto-starting queued job ${qJob.id} for user ${userId}`);
  try {
    await runExtractionJob(qJob.id, sessionIds, userId);
  } catch (err) {
    log.error("Extract", `auto-start failed for job ${qJob.id}: ${String(err)}`);
    await supabaseService.failJob(qJob.id, String(err));
    await autoStartNextQueuedJob(userId);
  }
}

async function setEnrichingPhase(jobId: string): Promise<void> {
  try {
    const job = await supabaseService.getJob(jobId);
    const currentProgress = (job.progress || {}) as Record<string, unknown>;
    await supabaseService.storeProgress(jobId, {
      ...currentProgress,
      phase: "enriching",
      enrichment_started_at: new Date().toISOString(),
    });
    log.info("Extract", `job ${jobId} entered enriching phase`);
  } catch (err) {
    log.debug("Extract", `setEnrichingPhase failed: ${String(err)}`);
  }
}

async function runExtractionJob(jobId: string, sessionIds: string[], userId: string): Promise<void> {
  const primarySessionId = sessionIds[0];
  const job = await supabaseService.getJob(jobId);
  const jobConfig = (job.config || {}) as Record<string, unknown>;
  const ctx: JobContext = {
    jobId,
    workspaceId: job.workspace_id,
    sessionId: primarySessionId,
    type: job.type as ExtractionType,
    sourceUrl: job.source,
    maxResults: (jobConfig.max_results as number) || 10000,
    skipDuplicates: jobConfig.skip_duplicates !== false,
    cursor: jobConfig.cursor as string | undefined,
  };

  const isIg = isIgType(job.type as string);
  const sessionPages: Array<{ sessionId: string; page: import("playwright").Page; contextId: string }> = [];
  for (const sid of sessionIds) {
    if (isIg) {
      const { cookies, proxy } = await igSupabaseService.getIgSessionAndCookies(sid);
      const created = await igContextManager.createContext(sid, cookies, proxy);
      sessionPages.push({ sessionId: sid, page: created.page, contextId: created.contextId });
    } else {
      const { cookies, proxy } = await supabaseService.getSessionAndCookies(sid);
      const created = await contextManager.createContext(sid, cookies, proxy);
      sessionPages.push({ sessionId: sid, page: created.page, contextId: created.contextId });
    }
  }
  const releasePages = async () => {
    for (const sp of sessionPages) {
      if (isIg) await igContextManager.releaseContext(sp.contextId);
      else await contextManager.releaseContext(sp.contextId);
    }
  };

  const page = sessionPages[0].page;

  const currentStatus = await supabaseService.getJobStatus(jobId);
  if (currentStatus === "canceled") {
    log.info("Extract", `job ${jobId} was canceled before start, skipping`);
    await releasePages();
    return;
  }

  await supabaseService.updateJob(jobId, { status: "running", error: null, started_at: new Date().toISOString() });

  jobQueue.enqueue(
    async () => {
      try {
        log.info("Extract", `job ${jobId} started`, { sessionIds });

        if (!ctx.cursor && !isIg) {
          log.info("Extract", `pre-flight auth check`);
          await page.goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
            timeout: config.fbNavTimeoutMs,
          });
          await page.waitForTimeout(3000);
          const html = await page.content();
          const finalUrl = page.url();
          const authState = detectAuthState(html, finalUrl);

          if (authState !== "authenticated") {
            const code = authStateToErrorCode(authState);
            const message = authStateToMessage(authState);
            log.warn("Extract", `auth check FAILED: ${code}`, { authState, finalUrl });

            // Update session status so dashboard doesn't show stale "connected" state
            await supabaseService.updateSessionStatus(primarySessionId, "disconnected", message).catch(() => {});

            await supabaseService.failJob(jobId, message);
            return;
          }
          log.info("Extract", "auth check PASSED");
        }

        const secondaryPages = sessionPages.slice(1).map(sp => ({
          sessionId: sp.sessionId,
          page: sp.page,
        }));
        const extractor = createExtractor(job.type as ExtractionType, page, ctx, secondaryPages);
        const startMs = Date.now();
        const result = await extractor.extract();
        const durationMs = Date.now() - startMs;

        if (result.done) {
          const currentStatus = await supabaseService.getJobStatus(jobId);
          if (currentStatus === "canceled") {
            log.info("Extract", `job ${jobId} stopped by user`, { extracted: result.extracted, durationMs });
            if (result.extracted > 0) {
              await setEnrichingPhase(jobId);
              await enrichmentService.enrichJobResults(jobId).catch((err) => log.error("Extract", `enrichment failed: ${String(err)}`));
            }
            await supabaseService.updateJob(jobId, { status: "completed", completed_at: new Date().toISOString() });
          } else {
            log.info("Extract", `job ${jobId} extraction done, starting enrichment`, { extracted: result.extracted, durationMs });
            if (result.extracted > 0) {
              await setEnrichingPhase(jobId);
              await enrichmentService.enrichJobResults(jobId).catch((err) => log.error("Extract", `enrichment failed: ${String(err)}`));
            }
            await supabaseService.updateJob(jobId, {
              status: "completed",
              completed_at: new Date().toISOString(),
            });
            log.info("Extract", `job ${jobId} completed (enrichment done)`, { extracted: result.extracted });
          }
        } else if (result.nextCursor) {
          await supabaseService.updateJob(jobId, {
            status: "paused",
            config: { ...jobConfig, cursor: result.nextCursor },
          });
          log.info("Extract", `job ${jobId} paused`, { extracted: result.extracted, durationMs, cursor: result.nextCursor });
          if (result.extracted > 0) {
            await setEnrichingPhase(jobId);
            await enrichmentService.enrichJobResults(jobId).catch((err) => log.error("Extract", `enrichment failed: ${String(err)}`));
          }
        } else {
          log.info("Extract", `job ${jobId} extraction done (no more pages), starting enrichment`, { extracted: result.extracted, durationMs });
          if (result.extracted > 0) {
            await setEnrichingPhase(jobId);
            await enrichmentService.enrichJobResults(jobId).catch((err) => log.error("Extract", `enrichment failed: ${String(err)}`));
          }
          await supabaseService.updateJob(jobId, {
            status: "completed",
            completed_at: new Date().toISOString(),
          });
          log.info("Extract", `job ${jobId} completed (enrichment done)`, { extracted: result.extracted });
        }
      } catch (err) {
        const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
        const message = err instanceof Error ? err.message : String(err);
        log.error("Extract", `error: ${code}`, { message });
        await supabaseService.failJob(jobId, message);
      } finally {
        await releasePages();
        await autoStartNextQueuedJob(userId);
      }
    },
    async () => {
      await releasePages();
      await supabaseService.failJob(jobId, "Extraction failed after retries");
      await autoStartNextQueuedJob(userId);
    },
  );
}

router.post("/extract", async (req, res) => {
  try {
    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map((i) => i.message).join(", ") },
      });
    }

    const body = parsed.data;

    // Resolve session IDs: merge session_id + session_ids, dedup
    let allSessionIds: string[] = [];
    if (body.session_id) allSessionIds.push(body.session_id);
    if (body.session_ids) for (const sid of body.session_ids) if (!allSessionIds.includes(sid)) allSessionIds.push(sid);

    // On resume (job_id provided), preserve original multi-session setup from job config
    if (body.job_id && allSessionIds.length <= 1) {
      try {
        const existingJob = await supabaseService.getJob(body.job_id);
        const savedSessionIds = (existingJob.config as { session_ids?: string[] } | null)?.session_ids;
        if (savedSessionIds && savedSessionIds.length > 1) {
          allSessionIds = savedSessionIds;
          log.info("Extract", `resume: restored ${savedSessionIds.length} sessions from job config`);
        }
      } catch (err) {
        log.warn("Extract", `resume: could not read job config, continuing with provided session: ${String(err)}`);
      }
    }

    // Validate all sessions exist and are connected
    const isIg = isIgType(body.type);
    const primarySessionId = allSessionIds[0];
    let sessionUserId: string;
    let sessionWorkspaceId: string;

    if (isIg) {
      const igPrimary = await igSupabaseService.getIgSessionAndCookies(primarySessionId);
      sessionUserId = igPrimary.session.user_id;
      for (let i = 1; i < allSessionIds.length; i++) {
        const { session: s } = await igSupabaseService.getIgSessionAndCookies(allSessionIds[i]);
        if (s.user_id !== sessionUserId) {
          return res.status(400).json({
            error: { code: ErrorCodes.INVALID_INPUT, message: `All sessions must belong to the same user` },
          });
        }
      }
      sessionWorkspaceId = await igSupabaseService.resolveIgWorkspaceId(sessionUserId);
    } else {
      const { session } = await supabaseService.getSessionAndCookies(primarySessionId);
      sessionUserId = session.user_id;
      sessionWorkspaceId = session.workspace_id;
      for (let i = 1; i < allSessionIds.length; i++) {
        const { session: s } = await supabaseService.getSessionAndCookies(allSessionIds[i]);
        if (s.workspace_id !== sessionWorkspaceId) {
          return res.status(400).json({
            error: { code: ErrorCodes.INVALID_INPUT, message: `All sessions must belong to the same workspace` },
          });
        }
      }
    }

    log.info("Extract", `request received`, {
      session_ids: allSessionIds,
      type: body.type,
      source_url: body.source_url,
    });

    let currentJobId = body.job_id;
    // For new jobs, only block if there's an actively RUNNING job.
    // Paused jobs are stopped and should not prevent starting a new extraction.
    const checkStatuses = currentJobId ? ["running"] : ["running"];
    const activeCheck = await supabaseService.hasActiveJob(sessionUserId, currentJobId || undefined, checkStatuses);

    if (activeCheck.active) {
      const statusMsg = activeCheck.jobStatus === "paused" ? "متوقفة مؤقتاً" : "قيد التشغيل";
      return res.status(409).json({
        error: {
          code: ErrorCodes.JOB_ALREADY_ACTIVE,
          message: `لديك مهمة استخراج ${statusMsg} بالفعل (${activeCheck.jobName}). يرجى الانتظار حتى تكتمل أو إلغاؤها قبل استئناف مهمة أخرى.`,
        },
      });
    }

    if (!currentJobId) {
      const job = await supabaseService.createJob({
        workspaceId: sessionWorkspaceId,
        userId: sessionUserId,
        type: body.type as ExtractionType,
        source: body.source_url,
        name: body.job_name || `Extract ${body.type}`,
        config: { max_results: body.max_results, skip_duplicates: body.skip_duplicates, session_ids: allSessionIds },
      });
      currentJobId = job.id;
      log.info("Extract", `job created: ${currentJobId}`);
    } else {
      log.info("Extract", `resuming job: ${currentJobId}`);
    }

    runExtractionJob(currentJobId, allSessionIds, sessionUserId)
      .catch((err) => log.error("Extract", `background runExtractionJob error: ${String(err)}`));

    return res.status(200).json({
      job_id: currentJobId,
      status: "running",
      result_count: 0,
      progress: 0,
    });
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("Extract", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

const exportSchema = z.object({
  job_id: z.string().min(1),
  format: z.enum(["csv", "json", "xlsx"]).default("csv"),
});

router.post("/export", async (req, res) => {
  try {
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: "Invalid request" } });
    }

    const { job_id, format } = parsed.data;
    const results = await supabaseService.getJobResults(job_id);
    if (!results || results.length === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "No results found" } });
    }

    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=flowtix-export-${job_id}.json`);
      return res.json(results.map((r: any) => {
        const enrichment = r.metadata?.enrichment || {};
        return {
          id: r.fb_id,
          name: r.data?.name || "",
          profile_url: r.data?.profile_url || "",
          avatar_url: r.data?.avatar_url || "",
          phone: enrichment.phone || "",
          first_name: enrichment.first_name || "",
          last_name: enrichment.last_name || "",
          email: enrichment.email || "",
          birthday: enrichment.birthday || "",
          birthdayYear: enrichment.birthdayYear || "",
          gender: enrichment.gender || "",
          hometown: enrichment.hometown || "",
          location: enrichment.location || "",
          country: enrichment.country || "",
          work: enrichment.work || "",
          education: enrichment.education || "",
          relationship: enrichment.relationship || "",
          religion: enrichment.religion || "",
          about_me: enrichment.about_me || "",
          source_db: enrichment.source_db || "",
        };
      }));
    }

    if (format === "csv") {
      const enrichmentFields = ["phone", "first_name", "last_name", "email", "birthday", "birthdayYear", "gender", "hometown", "location", "country", "work", "education", "relationship", "religion", "about_me"];
      const header = `\uFEFFمعرف فيسبوك,الاسم,رابط الحساب,رقم الجوال,الاسم الأول,الاسم الأخير,البريد الإلكتروني,تاريخ الميلاد,سنة الميلاد,الجنس,المدينة الأصلية,الموقع,البلد,العمل,التعليم,الحالة الاجتماعية,الدين,نبذة`;
      const rows = results.map((r: any) => {
        const name = (r.data?.name || "").replace(/"/g, '""');
        const profile = (r.data?.profile_url || "").replace(/"/g, '""');
        const enrichment = r.metadata?.enrichment || {};
        const enrichmentValues = enrichmentFields.map((f) => {
          const v = enrichment[f] || "";
          return `"${String(v).replace(/"/g, '""')}"`;
        }).join(",");
        return `"${r.fb_id}","${name}","${profile}",${enrichmentValues}`;
      }).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=flowtix-export-${job_id}.csv`);
      return res.send(`${header}\n${rows}`);
    }

    if (format === "xlsx") {
      const enrichmentFields = ["phone", "first_name", "last_name", "email", "birthday", "birthdayYear", "gender", "hometown", "location", "country", "work", "education", "relationship", "religion", "about_me"];
      const headers = ["FB ID", "الاسم", "رابط الحساب", "رقم الجوال", "الاسم الأول", "الاسم الأخير", "البريد الإلكتروني", "تاريخ الميلاد", "سنة الميلاد", "الجنس", "المدينة الأصلية", "الموقع", "البلد", "العمل", "التعليم", "الحالة الاجتماعية", "الدين", "نبذة"];
      const rows = results.map((r: any) => {
        const enrichment = r.metadata?.enrichment || {};
        return [
          r.fb_id || "",
          r.data?.name || "",
          r.data?.profile_url || "",
          enrichment.phone || "",
          enrichment.first_name || "",
          enrichment.last_name || "",
          enrichment.email || "",
          enrichment.birthday || "",
          enrichment.birthdayYear || "",
          enrichment.gender || "",
          enrichment.hometown || "",
          enrichment.location || "",
          enrichment.country || "",
          enrichment.work || "",
          enrichment.education || "",
          enrichment.relationship || "",
          enrichment.religion || "",
          enrichment.about_me || "",
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = headers.map(() => ({ wch: 25 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "FlowTix Export");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=flowtix-export-${job_id}.xlsx`);
      return res.send(Buffer.from(buffer));
    }

    res.status(400).json({ error: { code: "INVALID_FORMAT", message: "Unsupported format" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Export", `error: ${message}`);
    res.status(500).json({ error: { code: "EXPORT_FAILED", message } });
  }
});

const broadcastSchema = z.object({
  job_id: z.string().min(1),
  message: z.string().min(1).max(5000),
});

router.post("/broadcast", async (req, res) => {
  try {
    const parsed = broadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: "Invalid request" } });
    }

    const { job_id, message } = parsed.data;
    const results = await supabaseService.getJobResults(job_id);
    if (!results || results.length === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "No contacts to broadcast to" } });
    }

    // For now, store the broadcast request and return success
    // Full Playwright-based sending will be implemented in a future update
    await supabaseService.updateJob(job_id, {
      config: await supabaseService.getJob(job_id).then(j => ({
        ...j.config,
        broadcast_message: message,
        broadcast_requested_at: new Date().toISOString(),
      })).catch(() => ({})),
    });

    log.info("Broadcast", `broadcast requested for job ${job_id}: ${results.length} contacts`);

    return res.status(200).json({
      status: "queued",
      contact_count: results.length,
      message: "Broadcast queued successfully",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Broadcast", `error: ${message}`);
    res.status(500).json({ error: { code: "BROADCAST_FAILED", message } });
  }
});

const enrichSchema = z.object({
  job_id: z.string().min(1),
});

router.post("/enrich", async (req, res) => {
  try {
    const parsed = enrichSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: "Invalid request" } });
    }
    const { job_id } = parsed.data;

    log.info("Enrich", `manual enrichment requested for job ${job_id}`);
    await enrichmentService.enrichJobResults(job_id);

    return res.status(200).json({ status: "ok", message: "Enrichment completed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Enrich", `error: ${message}`);
    res.status(500).json({ error: { code: "ENRICH_FAILED", message } });
  }
});

export default router;

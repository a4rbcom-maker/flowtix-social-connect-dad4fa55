// Background worker for bulk_jobs.
// Called by pg_cron every minute via /api/public/hooks/process-bulk-jobs.
// Uses service-role admin client to advance jobs across all users.
// Enforces: caption-merged sends, per-user daily cap, batch rest periods,
// random jitter, spintax, invalid-phone skip-list, existing-contact
// priority, global bridge rate-limit, circuit breaker, priority queue.
import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

const MAX_JOBS_PER_TICK = 25;
const DEFAULT_BATCH_SIZE = 10;
const HARD_CAP_SENDS_PER_JOB_PER_TICK = 100;
// pg_cron ticks every 60s; global tick budget = msgs_per_second * 60
const TICK_WINDOW_SECONDS = 60;

export const Route = createFileRoute("/api/public/hooks/process-bulk-jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET || process.env.BOT_WORKER_SECRET;
        if (!secret) {
          return new Response("Worker secret not configured", { status: 500 });
        }
        const auth = request.headers.get("authorization");
        if (!auth || auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { waBridge, assertBridgeSendQueued, bridgeSendQueuedMessage, bridgeSendFailureMessage, BridgeError, inferStatus } = await import(
          "@/lib/wa-bridge.server"
        );
        const { normalizeWhatsappPhone } = await import("@/lib/wa-chat-helpers.server");
        const { resolveOutgoingWhatsappTarget } = await import("@/lib/wa-recipient.server");
        const {
          DEFAULT_BULK_GLOBAL_CONFIG,
          DEFAULT_USER_SETTINGS,
          renderMessage,
          jitterMs,
          isNotOnWhatsappError,
        } = await import("@/lib/bulk-helpers.server");

        const describeErr = (err: unknown): string => {
          if (err instanceof BridgeError) {
            return bridgeSendFailureMessage(err.body) || err.message || "Bridge error";
          }
          return err instanceof Error ? err.message : "Send failed";
        };
        const isQueueToken = (value: unknown): boolean => {
          if (typeof value !== "string") return false;
          const id = value.trim().toLowerCase();
          return id === "queued" || /^q[_-]/.test(id) || /^queue[_-]/.test(id);
        };
        const acceptedBridgeId = (res: unknown): { id: string; queuedOnly: boolean } => {
          const queuedId = bridgeSendQueuedMessage(res);
          try {
            const confirmed = assertBridgeSendQueued(res as Parameters<typeof assertBridgeSendQueued>[0]);
            const isQueuedOnly = !confirmed || isQueueToken(confirmed);
            return { id: confirmed || queuedId || "queued", queuedOnly: isQueuedOnly };
          } catch (err) {
            if (queuedId) return { id: queuedId, queuedOnly: true };
            throw err;
          }
        };
        const QUEUED_STALE_MS = 5 * 60 * 1000;

        const parseMetadata = (metadata: unknown): Record<string, unknown> => {
          return metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : {};
        };
        const extractRecipientPhone = (recipient: unknown): string | null => {
          const text = String(recipient ?? "");
          const match = text.match(/\(([^()]+)\)\s*$/) || text.match(/(\+?\d[\d\s().-]{5,}\d)/);
          const raw = (match?.[1] ?? match?.[0] ?? "").replace(/[^\d+]/g, "");
          return normalizeWhatsappPhone(raw) || raw.replace(/\D/g, "") || null;
        };

        const recomputeJobCounts = async (jobId: string) => {
          const { data: rows } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("status")
            .eq("job_id", jobId);
          const sentCount = (rows ?? []).filter((r) => r.status === "success").length;
          const failedCount = (rows ?? []).filter((r) => r.status === "failed").length;
          const unresolvedCount = (rows ?? []).filter((r) => r.status === "pending" || r.status === "processing").length;
          if (failedCount > 0 && unresolvedCount === 0) {
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                sent_count: sentCount,
                failed_count: failedCount,
                updated_at: new Date().toISOString(),
                status: "failed",
                error_message: "قبل الجسر الطلب لكن لم يتم تأكيد التسليم — أعد ربط واتساب ثم استأنف الحملة",
                next_send_at: null,
              })
              .eq("id", jobId);
            return;
          }
          await supabaseAdmin
            .from("bulk_jobs")
            .update({
              sent_count: sentCount,
              failed_count: failedCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        };

        const repairFalseQueuedSuccesses = async () => {
          const cutoffIso = new Date(Date.now() - QUEUED_STALE_MS).toISOString();
          const { data: logs } = await supabaseAdmin
            .from("send_log")
            .select("id, recipient, metadata, created_at")
            .eq("channel", "bulk")
            .eq("action", "bulk_send")
            .eq("status", "success")
            .order("created_at", { ascending: false })
            .limit(500);

          const affectedJobs = new Set<string>();
          for (const log of logs ?? []) {
            const meta = parseMetadata(log.metadata);
            const providerMessageId = meta.provider_message_id;
            const jobId = typeof meta.job_id === "string" ? meta.job_id : null;
            if (!jobId || !isQueueToken(providerMessageId) || String(log.created_at) > cutoffIso) continue;

            await supabaseAdmin
              .from("send_log")
              .update({
                status: "failed",
                error_message: "قبل الجسر الطلب لكن لم يتم تأكيد التسليم — أعد ربط واتساب ثم استأنف",
                metadata: { ...meta, queued_only: true, auto_repaired: true } as never,
              })
              .eq("id", log.id);

            const phone = extractRecipientPhone(log.recipient);
            const { data: recipients } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("id, phone")
              .eq("job_id", jobId)
              .eq("status", "success");
            const matching = (recipients ?? []).filter((r) => {
              const normalized = normalizeWhatsappPhone(r.phone) || String(r.phone ?? "").replace(/\D/g, "");
              return !phone || normalized === phone || String(r.phone ?? "").replace(/\D/g, "") === phone;
            });
            for (const recipient of matching) {
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "failed",
                  error_message: "قبل الجسر الطلب لكن لم يتم تأكيد التسليم — أعد ربط واتساب ثم استأنف",
                  sent_at: new Date().toISOString(),
                })
                .eq("id", recipient.id);
            }
            affectedJobs.add(jobId);
          }

          for (const jobId of affectedJobs) await recomputeJobCounts(jobId);
          return affectedJobs.size;
        };

        const now = new Date();
        const todayISO = now.toISOString().slice(0, 10);
        const summary = {
          promoted: 0,
          processed: 0,
          sent: 0,
          failed: 0,
          completed: 0,
          skipped_no_session: 0,
          repaired_false_success: 0,
          circuit_paused: false,
          global_budget_hit: false,
          daily_cap_hit: 0,
          resting: 0,
        };

        summary.repaired_false_success = await repairFalseQueuedSuccesses();

        // ────────────────────────────────────────────────────────────────
        // Global config: bridge rate-limit + circuit breaker
        // ────────────────────────────────────────────────────────────────
        const { data: settingsRows } = await supabaseAdmin
          .from("platform_settings")
          .select("key, value")
          .in("key", ["bulk_rate_limit", "bulk_circuit_state"]);
        const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
        const cfgRaw = (settingsMap.get("bulk_rate_limit") ?? {}) as Record<string, unknown>;
        const cfg = {
          ...DEFAULT_BULK_GLOBAL_CONFIG,
          ...Object.fromEntries(
            Object.entries(cfgRaw).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
          ),
        };
        const circuitState = (settingsMap.get("bulk_circuit_state") ?? {}) as Record<string, unknown>;
        const pausedUntil = typeof circuitState.paused_until === "string" ? new Date(circuitState.paused_until) : null;

        // Circuit breaker: still paused?
        if (pausedUntil && pausedUntil > now) {
          summary.circuit_paused = true;
          return new Response(
            JSON.stringify({ ok: true, ...summary, paused_until: pausedUntil.toISOString(), ranAt: now.toISOString() }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // Circuit breaker: check recent failure rate across the platform
        const windowStart = new Date(now.getTime() - cfg.circuit_breaker_window_min * 60_000).toISOString();
        const { data: recentLogs } = await supabaseAdmin
          .from("send_log")
          .select("status")
          .eq("channel", "bulk")
          .eq("action", "bulk_send")
          .gte("created_at", windowStart);
        const total = recentLogs?.length ?? 0;
        const failedRecent = (recentLogs ?? []).filter((r) => r.status === "failed").length;
        if (total >= 20 && (failedRecent / total) * 100 >= cfg.circuit_breaker_failure_pct) {
          const until = new Date(now.getTime() + cfg.circuit_breaker_pause_min * 60_000).toISOString();
          await supabaseAdmin
            .from("platform_settings")
            .update({ value: { paused_until: until, last_check_at: now.toISOString() } as never })
            .eq("key", "bulk_circuit_state");
          summary.circuit_paused = true;
          return new Response(
            JSON.stringify({ ok: true, ...summary, tripped_at: now.toISOString(), paused_until: until }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // Global tick budget (bridge protection). Cron ticks every 60s.
        let globalBudget = Math.max(1, Math.floor(cfg.global_msgs_per_second * TICK_WINDOW_SECONDS));

        // ────────────────────────────────────────────────────────────────
        // Per-user config cache
        // ────────────────────────────────────────────────────────────────
        const userSettingsCache = new Map<string, typeof DEFAULT_USER_SETTINGS>();
        async function getUserSettings(userId: string) {
          if (userSettingsCache.has(userId)) return userSettingsCache.get(userId)!;
          const { data } = await supabaseAdmin
            .from("whatsapp_settings")
            .select("max_concurrent_campaigns, daily_message_cap, messages_per_batch, batch_rest_seconds, jitter_min_seconds, jitter_max_seconds, enable_spintax, prioritize_existing_contacts, skip_after_failures")
            .eq("user_id", userId)
            .maybeSingle();
          const merged = { ...DEFAULT_USER_SETTINGS, ...(data ?? {}) };
          // Hard cap: strictly 1 running campaign per user (anti-ban safety).
          merged.max_concurrent_campaigns = 1;

          userSettingsCache.set(userId, merged);
          return merged;
        }

        // Track running jobs per user (seeded from DB)
        const runningPerUser = new Map<string, number>();
        {
          const { data: currentlyRunning } = await supabaseAdmin
            .from("bulk_jobs")
            .select("user_id")
            .eq("status", "running");
          for (const r of currentlyRunning ?? []) {
            runningPerUser.set(r.user_id, (runningPerUser.get(r.user_id) ?? 0) + 1);
          }
        }

        // ────────────────────────────────────────────────────────────────
        // 1) Promote scheduled → running (respecting per-user cap)
        // ────────────────────────────────────────────────────────────────
        const { data: due } = await supabaseAdmin
          .from("bulk_jobs")
          .select("id, user_id, scheduled_at")
          .eq("status", "scheduled")
          .lte("scheduled_at", now.toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(MAX_JOBS_PER_TICK);

        for (const job of due ?? []) {
          const settings = await getUserSettings(job.user_id);
          const active = runningPerUser.get(job.user_id) ?? 0;
          if (active >= settings.max_concurrent_campaigns) continue;
          await supabaseAdmin
            .from("bulk_jobs")
            .update({
              status: "running",
              started_at: now.toISOString(),
              next_send_at: now.toISOString(),
            })
            .eq("id", job.id);
          runningPerUser.set(job.user_id, active + 1);
          summary.promoted++;
        }

        // ────────────────────────────────────────────────────────────────
        // 2) Load running jobs, sort by priority (small jobs first)
        // ────────────────────────────────────────────────────────────────
        const { data: runningRaw } = await supabaseAdmin
          .from("bulk_jobs")
          .select("*")
          .eq("status", "running")
          .lte("next_send_at", now.toISOString())
          .order("started_at", { ascending: true })
          .limit(MAX_JOBS_PER_TICK);

        // Compute pending count per job for priority sort
        const jobPendingCounts = new Map<string, number>();
        for (const j of runningRaw ?? []) {
          const { count } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("id", { head: true, count: "exact" })
            .eq("job_id", j.id)
            .eq("status", "pending");
          jobPendingCounts.set(j.id, count ?? 0);
        }
        // Priority: small jobs (<= threshold) first, then FIFO by started_at
        const running = [...(runningRaw ?? [])].sort((a, b) => {
          const aSmall = (jobPendingCounts.get(a.id) ?? 0) <= cfg.small_job_threshold ? 0 : 1;
          const bSmall = (jobPendingCounts.get(b.id) ?? 0) <= cfg.small_job_threshold ? 0 : 1;
          if (aSmall !== bSmall) return aSmall - bSmall;
          return String(a.started_at ?? "").localeCompare(String(b.started_at ?? ""));
        });

        const processedPerUser = new Map<string, number>();
        const sessionCache = new Map<string, { session_id: string; status: string; daily_sent_count: number; daily_sent_date: string | null; batch_counter: number; rest_until: string | null } | null>();
        async function getSession(userId: string) {
          if (sessionCache.has(userId)) return sessionCache.get(userId) ?? null;
          const { data } = await supabaseAdmin
            .from("wa_sessions")
            .select("session_id, status, daily_sent_count, daily_sent_date, batch_counter, rest_until")
            .eq("user_id", userId)
            .maybeSingle();
          const row = data && data.session_id
            ? {
                session_id: data.session_id,
                status: data.status,
                daily_sent_count: data.daily_sent_count ?? 0,
                daily_sent_date: data.daily_sent_date ?? null,
                batch_counter: data.batch_counter ?? 0,
                rest_until: data.rest_until ?? null,
              }
            : null;
          sessionCache.set(userId, row);
          return row;
        }

        for (const job of running) {
          if (globalBudget <= 0) {
            summary.global_budget_hit = true;
            break;
          }

          const settings = await getUserSettings(job.user_id);
          const done = processedPerUser.get(job.user_id) ?? 0;
          if (done >= settings.max_concurrent_campaigns) continue;
          processedPerUser.set(job.user_id, done + 1);
          summary.processed++;

          const batchSize = Math.max(
            1,
            Math.min(job.batch_size ?? DEFAULT_BATCH_SIZE, HARD_CAP_SENDS_PER_JOB_PER_TICK, settings.messages_per_batch, globalBudget),
          );

          // Verify WA session
          const sess = await getSession(job.user_id);
          if (!sess?.session_id) {
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                status: "paused",
                error_message: "WhatsApp غير متصل — قم بإعادة الربط ثم استأنف الحملة",
                next_send_at: null,
              })
              .eq("id", job.id);
            summary.skipped_no_session++;
            continue;
          }

          // Reset daily counter if day rolled over
          let dailySent = sess.daily_sent_count;
          if (sess.daily_sent_date !== todayISO) {
            dailySent = 0;
            await supabaseAdmin
              .from("wa_sessions")
              .update({ daily_sent_count: 0, daily_sent_date: todayISO, batch_counter: 0 })
              .eq("user_id", job.user_id)
              .eq("session_id", sess.session_id);
            sess.daily_sent_count = 0;
            sess.daily_sent_date = todayISO;
            sess.batch_counter = 0;
          }

          // Check daily cap
          if (dailySent >= settings.daily_message_cap) {
            const tomorrow = new Date(now);
            tomorrow.setUTCHours(24, 0, 0, 0);
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                next_send_at: tomorrow.toISOString(),
                error_message: `تم الوصول للحد اليومي (${settings.daily_message_cap} رسالة) — سيستأنف تلقائياً غداً`,
              })
              .eq("id", job.id);
            summary.daily_cap_hit++;
            continue;
          }

          // Check batch rest
          if (sess.rest_until && new Date(sess.rest_until) > now) {
            await supabaseAdmin
              .from("bulk_jobs")
              .update({ next_send_at: sess.rest_until })
              .eq("id", job.id);
            summary.resting++;
            continue;
          }

          try {
            const live = await waBridge.getStatus(sess.session_id);
            const liveStatus = inferStatus(live);
            if (liveStatus !== "connected") {
              await supabaseAdmin
                .from("bulk_jobs")
                .update({
                  error_message: "تعذر تأكيد حالة واتساب من الخادم — سنحاول تلقائياً في الدورة القادمة",
                  next_send_at: new Date(Date.now() + 60_000).toISOString(),
                })
                .eq("id", job.id);
              summary.skipped_no_session++;
              continue;
            }
            await supabaseAdmin
              .from("wa_sessions")
              .update({ status: "connected", last_seen_at: new Date().toISOString() })
              .eq("user_id", job.user_id)
              .eq("session_id", sess.session_id);
          } catch (err) {
            const status = err instanceof BridgeError ? err.status : 0;
            const msg = err instanceof Error ? err.message : String(err);
            const trustedGone = status === 401 || /logged.?out|logout|unauthorized|removed.*device|device.*removed|unlinked/i.test(msg);
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                status: trustedGone ? "paused" : "running",
                error_message: trustedGone
                  ? "تم قطع واتساب من الجهاز أو الموقع — أعد الربط ثم استأنف الحملة"
                  : "تعذر فحص جلسة واتساب مؤقتاً — سيتم الاستئناف بعد التأكد من الاتصال",
                next_send_at: trustedGone ? null : new Date(Date.now() + 60_000).toISOString(),
              })
              .eq("id", job.id);
            if (trustedGone) {
              await supabaseAdmin
                .from("wa_sessions")
                .update({ status: "disconnected", last_seen_at: new Date().toISOString() })
                .eq("user_id", job.user_id)
                .eq("session_id", sess.session_id);
            }
            summary.skipped_no_session++;
            continue;
          }

          let sent = 0;
          let failed = 0;

          // Sweep stale processing
          const staleCutoff = new Date(Date.now() - QUEUED_STALE_MS).toISOString();
          const { data: stale } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("id")
            .eq("job_id", job.id)
            .eq("status", "processing")
            .lt("sent_at", staleCutoff);
          if (stale && stale.length > 0) {
            const ids = stale.map((s) => s.id);
            await supabaseAdmin
              .from("bulk_job_recipients")
              .update({
                status: "failed",
                error_message: "قبل الجسر الطلب لكن لم يتم تأكيد التسليم — أعد ربط واتساب ثم استأنف",
                sent_at: new Date().toISOString(),
              })
              .in("id", ids);
            failed += ids.length;
          }

          // Load invalid-phone skip list for this user
          const { data: skipRows } = await supabaseAdmin
            .from("wa_invalid_phones")
            .select("phone, failure_count")
            .eq("user_id", job.user_id)
            .gte("failure_count", settings.skip_after_failures);
          const skipSet = new Set((skipRows ?? []).map((r) => r.phone));

          // Load existing-contact phone set for priority sort
          let existingSet: Set<string> = new Set();
          if (settings.prioritize_existing_contacts) {
            const { data: convRows } = await supabaseAdmin
              .from("wa_conversations")
              .select("remote_jid")
              .eq("user_id", job.user_id)
              .limit(5000);
            existingSet = new Set(
              (convRows ?? [])
                .map((c) => String(c.remote_jid ?? "").split("@")[0].replace(/\D/g, ""))
                .filter(Boolean),
            );
          }

          // Fetch more than batch to allow re-ordering / filtering
          const { data: candidates } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("id, name, phone")
            .eq("job_id", job.id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(batchSize * 3);

          // Filter blacklist, sort by existing-contact priority
          const filtered = (candidates ?? []).filter((r) => {
            const norm = normalizeWhatsappPhone(r.phone) || "";
            return !skipSet.has(norm) && !skipSet.has(r.phone);
          });
          filtered.sort((a, b) => {
            const aExists = existingSet.has(normalizeWhatsappPhone(a.phone) || "") ? 0 : 1;
            const bExists = existingSet.has(normalizeWhatsappPhone(b.phone) || "") ? 0 : 1;
            return aExists - bExists;
          });
          const pending = filtered.slice(0, batchSize);

          // Auto-mark blacklisted candidates as failed (so counts move)
          const blacklisted = (candidates ?? []).filter((r) => {
            const norm = normalizeWhatsappPhone(r.phone) || "";
            return skipSet.has(norm) || skipSet.has(r.phone);
          });
          for (const r of blacklisted) {
            await supabaseAdmin
              .from("bulk_job_recipients")
              .update({
                status: "failed",
                error_message: "رقم غير مسجل على واتساب — تم تخطيه لحماية الرقم من الحظر",
                sent_at: new Date().toISOString(),
              })
              .eq("id", r.id);
            failed++;
          }

          if (pending.length === 0) {
            const { count: stillProcessing } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("id", { head: true, count: "exact" })
              .eq("job_id", job.id)
              .eq("status", "processing");
            const { count: stillPending } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("id", { head: true, count: "exact" })
              .eq("job_id", job.id)
              .eq("status", "pending");
            if ((stillProcessing ?? 0) === 0 && (stillPending ?? 0) === 0) {
              const { data: finalRows } = await supabaseAdmin
                .from("bulk_job_recipients")
                .select("status")
                .eq("job_id", job.id);
              const finalSent = (finalRows ?? []).filter((r) => r.status === "success").length;
              const finalFailed = (finalRows ?? []).filter((r) => r.status === "failed").length;
              const finalStatus = finalSent === 0 && finalFailed > 0 ? "failed" : "completed";
              await supabaseAdmin
                .from("bulk_jobs")
                .update({
                  status: finalStatus,
                  completed_at: finalStatus === "completed" ? new Date().toISOString() : null,
                  next_send_at: null,
                  sent_count: finalSent,
                  failed_count: finalFailed,
                  error_message: finalStatus === "failed" ? "فشلت كل الرسائل — أعد ربط واتساب ثم استأنف الحملة" : null,
                })
                .eq("id", job.id);
              if (finalStatus === "completed") summary.completed++;
            } else {
              await supabaseAdmin
                .from("bulk_jobs")
                .update({
                  next_send_at: new Date(Date.now() + 60_000).toISOString(),
                  failed_count: (job.failed_count ?? 0) + failed,
                })
                .eq("id", job.id);
            }
            summary.failed += failed;
            continue;
          }

          // ──────────────────────────────────────────────────────────
          // Send batch
          // ──────────────────────────────────────────────────────────
          let batchCounter = sess.batch_counter;
          let restTriggered = false;
          let deferJob = false;

          for (const r of pending) {
            if (globalBudget <= 0) {
              summary.global_budget_hit = true;
              break;
            }
            if (dailySent >= settings.daily_message_cap) {
              summary.daily_cap_hit++;
              break;
            }

            const phone = normalizeWhatsappPhone(r.phone) || "";
            if (!phone || phone.length < 6) {
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({ status: "failed", error_message: "رقم غير صالح", sent_at: new Date().toISOString() })
                .eq("id", r.id);
              failed++;
              continue;
            }

            const rendered = renderMessage(job.message || "", { name: r.name, phone }, { spintax: settings.enable_spintax });
            let errorMessage: string | null = null;
            let providerId: string | null = null;
            let queuedOnly = false;
            let targetJid = `${phone}@s.whatsapp.net`;
            let targetPhone: string | null = phone;
            let usedLid = false;

            try {
              const resolvedTarget = await resolveOutgoingWhatsappTarget({
                userId: job.user_id,
                sessionId: sess.session_id,
                remoteJid: `${phone}@s.whatsapp.net`,
                fallbackPhoneOrJid: phone,
              });
              targetJid = resolvedTarget.jid;
              targetPhone = resolvedTarget.phoneDigits || phone;
              usedLid = resolvedTarget.usedLid;
              const caption = rendered.trim();
              if (job.image_url) {
                // Single message: image + caption (protects the number and
                // halves the send count vs. two separate messages).
                const res = await waBridge.sendMedia(sess.session_id, targetJid, job.image_url, {
                  mediaType: "image",
                  caption,
                  phone: targetPhone,
                });
                const parsed = acceptedBridgeId(res);
                providerId = parsed.id;
                queuedOnly = parsed.queuedOnly;
              } else {
                const res = await waBridge.sendText(sess.session_id, targetJid, caption, { phone: targetPhone });
                const parsed = acceptedBridgeId(res);
                providerId = parsed.id;
                queuedOnly = parsed.queuedOnly;
              }
            } catch (err) {
              errorMessage = describeErr(err);
              if (/logged.?out|logout|unauthorized|removed.*device|device.*removed|unlinked/i.test(errorMessage)) {
                await supabaseAdmin
                  .from("bulk_jobs")
                  .update({
                    status: "paused",
                    error_message: "توقفت جلسة واتساب أثناء الإرسال — أعد الربط/تحديث الحالة ثم استأنف الحملة",
                    next_send_at: null,
                  })
                  .eq("id", job.id);
                await supabaseAdmin
                  .from("wa_sessions")
                  .update({ status: "disconnected", last_seen_at: new Date().toISOString() })
                  .eq("user_id", job.user_id)
                  .eq("session_id", sess.session_id);
                break;
              }
              if (/session.*(not.?found|closed|not connected)|not connected/i.test(errorMessage)) {
                await supabaseAdmin
                  .from("bulk_jobs")
                  .update({
                    status: "running",
                    error_message: "تعذر الإرسال مؤقتاً بسبب حالة الخادم — سنحاول تلقائياً بدون فصل الجلسة",
                    next_send_at: new Date(Date.now() + 60_000).toISOString(),
                  })
                  .eq("id", job.id);
                errorMessage = null;
                deferJob = true;
                break;
              }
            }

            if (errorMessage) {
              failed++;
              // Track invalid-phone skip list
              if (isNotOnWhatsappError(errorMessage)) {
                await supabaseAdmin
                  .from("wa_invalid_phones")
                  .upsert(
                    {
                      user_id: job.user_id,
                      phone,
                      failure_count: 1,
                      last_failure_at: new Date().toISOString(),
                      last_reason: errorMessage.slice(0, 200),
                    } as never,
                    { onConflict: "user_id,phone", ignoreDuplicates: false },
                  );
                // Increment counter atomically via a follow-up update
                const { data: existing } = await supabaseAdmin
                  .from("wa_invalid_phones")
                  .select("failure_count")
                  .eq("user_id", job.user_id)
                  .eq("phone", phone)
                  .maybeSingle();
                const nextCount = Math.max(1, (existing?.failure_count ?? 1) + 1);
                await supabaseAdmin
                  .from("wa_invalid_phones")
                  .update({
                    failure_count: nextCount,
                    last_failure_at: new Date().toISOString(),
                    last_reason: errorMessage.slice(0, 200),
                  })
                  .eq("user_id", job.user_id)
                  .eq("phone", phone);
              }
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "failed",
                  error_message: errorMessage,
                  sent_at: new Date().toISOString(),
                })
                .eq("id", r.id);
            } else {
              const pendingRaw = {
                bulk: true,
                bulkJobId: job.id,
                bulkRecipientId: r.id,
                targetPhone: phone,
                targetJid,
                targetPhoneResolved: targetPhone,
                usedLid,
                bridgeAcceptedAt: new Date().toISOString(),
                delivery: queuedOnly ? "bridge_queued_waiting_for_whatsapp_ack" : "waiting_for_whatsapp_ack",
                queuedId: queuedOnly ? providerId : null,
                bridgeMessageId: queuedOnly ? null : providerId,
              } as never;

              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "processing",
                  sent_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq("id", r.id);

              await supabaseAdmin.from("wa_messages").insert({
                user_id: job.user_id,
                session_id: sess.session_id,
                direction: "out",
                remote_jid: targetJid,
                to_phone: targetPhone || phone,
                msg_type: job.image_url ? "image" : "text",
                text_body: rendered,
                media_url: job.image_url ?? null,
                status: "pending",
                provider_message_id: queuedOnly ? null : providerId,
                raw: pendingRaw,
              });

              await supabaseAdmin
                .from("wa_sessions")
                .update({ status: "connected", last_seen_at: new Date().toISOString() })
                .eq("user_id", job.user_id)
                .eq("session_id", sess.session_id);

              // Counters
              dailySent++;
              batchCounter++;
              globalBudget--;
              sent++;

              // Trigger batch rest?
              if (batchCounter >= settings.messages_per_batch) {
                const restUntil = new Date(Date.now() + settings.batch_rest_seconds * 1000);
                await supabaseAdmin
                  .from("wa_sessions")
                  .update({
                    daily_sent_count: dailySent,
                    daily_sent_date: todayISO,
                    batch_counter: 0,
                    rest_until: restUntil.toISOString(),
                  })
                  .eq("user_id", job.user_id)
                  .eq("session_id", sess.session_id);
                await supabaseAdmin
                  .from("bulk_jobs")
                  .update({ next_send_at: restUntil.toISOString() })
                  .eq("id", job.id);
                batchCounter = 0;
                sess.rest_until = restUntil.toISOString();
                restTriggered = true;
              }
            }

            await supabaseAdmin.from("send_log").insert({
              user_id: job.user_id,
              channel: "bulk",
              action: "bulk_send",
              status: errorMessage ? "failed" : "pending",
              title: job.title,
              description: (errorMessage ? "" : "قيد التأكيد من واتساب — ") + rendered.slice(0, 140),
              recipient: `${r.name} (${phone})`,
              error_message: errorMessage,
              metadata: {
                job_id: job.id,
                bulk_recipient_id: r.id,
                provider_message_id: queuedOnly ? null : providerId,
                queued_id: queuedOnly ? providerId : null,
                queued_only: queuedOnly,
                target_jid: targetJid,
                target_phone: targetPhone,
                used_lid: usedLid,
                awaiting_whatsapp_ack: !errorMessage,
              },
            });

            if (restTriggered) break;
          }

          // Persist counters (if not persisted by rest trigger)
          if (!restTriggered) {
            await supabaseAdmin
              .from("wa_sessions")
              .update({
                daily_sent_count: dailySent,
                daily_sent_date: todayISO,
                batch_counter: batchCounter,
              })
              .eq("user_id", job.user_id)
              .eq("session_id", sess.session_id);
          }

          summary.sent += sent;
          summary.failed += failed;

          if (!restTriggered) {
            // Random jitter for next send
            const nextAt = new Date(Date.now() + (deferJob ? 60_000 : jitterMs(settings.jitter_min_seconds, settings.jitter_max_seconds)));
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                sent_count: (job.sent_count ?? 0) + sent,
                failed_count: (job.failed_count ?? 0) + failed,
                next_send_at: nextAt.toISOString(),
                error_message: deferJob ? "تعذر الإرسال مؤقتاً بسبب حالة الخادم — سنحاول تلقائياً بدون فصل الجلسة" : job.error_message,
              })
              .eq("id", job.id);
          } else {
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                sent_count: (job.sent_count ?? 0) + sent,
                failed_count: (job.failed_count ?? 0) + failed,
              })
              .eq("id", job.id);
          }
        }

        return new Response(JSON.stringify({ ok: true, ...summary, ranAt: now.toISOString() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: methodNotAllowedHandler(["POST"]),
      HEAD: methodNotAllowedHandler(["POST"]),
      PUT: methodNotAllowedHandler(["POST"]),
      DELETE: methodNotAllowedHandler(["POST"]),
      PATCH: methodNotAllowedHandler(["POST"]),
    },
  },
});

// Background worker for bulk_jobs.
// Called by pg_cron every minute via /api/public/hooks/process-bulk-jobs.
// Uses service-role admin client to advance jobs across all users.
// Delivers real WhatsApp messages via the Bot-Xtra bridge using each
// user's connected wa_sessions row.
import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

const MAX_JOBS_PER_TICK = 25;
const DEFAULT_BATCH_SIZE = 10;
const HARD_CAP_SENDS_PER_JOB_PER_TICK = 100;

function renderTemplate(tpl: string, ctx: { name?: string | null; phone?: string | null }): string {
  if (!tpl) return "";
  return tpl
    .replace(/\{\{?\s*name\s*\}?\}/gi, ctx.name?.trim() || "")
    .replace(/\{\{?\s*phone\s*\}?\}/gi, ctx.phone?.trim() || "");
}

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
        const QUEUED_STALE_MS = 5 * 60 * 1000; // 5 min: bridge accepted but never confirmed

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
        const summary = {
          promoted: 0,
          processed: 0,
          sent: 0,
          failed: 0,
          completed: 0,
          skipped_no_session: 0,
          repaired_false_success: 0,
        };

        summary.repaired_false_success = await repairFalseQueuedSuccesses();

        // 1) Promote scheduled → running
        const { data: due } = await supabaseAdmin
          .from("bulk_jobs")
          .select("id")
          .eq("status", "scheduled")
          .lte("scheduled_at", now.toISOString())
          .limit(MAX_JOBS_PER_TICK);

        for (const job of due ?? []) {
          await supabaseAdmin
            .from("bulk_jobs")
            .update({
              status: "running",
              started_at: now.toISOString(),
              next_send_at: now.toISOString(),
            })
            .eq("id", job.id);
          summary.promoted++;
        }

        // 2) Process running jobs whose next_send_at is due
        const { data: running } = await supabaseAdmin
          .from("bulk_jobs")
          .select("*")
          .eq("status", "running")
          .lte("next_send_at", now.toISOString())
          .limit(MAX_JOBS_PER_TICK);

        // Cache wa_sessions per user for this tick
        const sessionCache = new Map<string, { session_id: string; status: string } | null>();
        async function getSession(userId: string) {
          if (sessionCache.has(userId)) return sessionCache.get(userId) ?? null;
          const { data } = await supabaseAdmin
            .from("wa_sessions")
            .select("session_id, status")
            .eq("user_id", userId)
            .maybeSingle();
          const row = data && data.session_id ? { session_id: data.session_id, status: data.status } : null;
          sessionCache.set(userId, row);
          return row;
        }

        for (const job of running ?? []) {
          summary.processed++;

          const batchSize = Math.max(
            1,
            Math.min(job.batch_size ?? DEFAULT_BATCH_SIZE, HARD_CAP_SENDS_PER_JOB_PER_TICK),
          );

          // Verify user has a connected WA session in DB and on the bridge.
          // A stale DB "connected" row must pause the campaign instead of marking every recipient failed.
          const sess = await getSession(job.user_id);
          if (!sess || sess.status !== "connected") {
            // Pause the job with a clear error until user reconnects
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
          try {
            const live = await waBridge.getStatus(sess.session_id);
            if (inferStatus(live) !== "connected") {
              await supabaseAdmin
                .from("bulk_jobs")
                .update({
                  status: "paused",
                  error_message: "جلسة واتساب غير جاهزة — افتح واتساب وأعد تحديث الحالة ثم استأنف الحملة",
                  next_send_at: null,
                })
                .eq("id", job.id);
              await supabaseAdmin
                .from("wa_sessions")
                .update({ status: inferStatus(live), last_seen_at: new Date().toISOString() })
                .eq("user_id", job.user_id)
                .eq("session_id", sess.session_id);
              summary.skipped_no_session++;
              continue;
            }
          } catch (err) {
            const status = err instanceof BridgeError ? err.status : 0;
            const hardGone = status === 404 || /session.*(not.?found|closed|logged.?out)/i.test(err instanceof Error ? err.message : String(err));
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                status: "paused",
                error_message: hardGone
                  ? "جلسة واتساب غير موجودة على خادم الربط — أعد الربط ثم استأنف الحملة"
                  : "تعذر فحص جلسة واتساب مؤقتاً — سيتم الاستئناف بعد التأكد من الاتصال",
                next_send_at: null,
              })
              .eq("id", job.id);
            if (hardGone) {
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

          // Sweep stale "processing" recipients (bridge accepted but never confirmed).
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

          const { data: pending } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("id, name, phone")
            .eq("job_id", job.id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(batchSize);

          if (!pending || pending.length === 0) {
            const { count: stillProcessing } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("id", { head: true, count: "exact" })
              .eq("job_id", job.id)
              .eq("status", "processing");
            if ((stillProcessing ?? 0) === 0) {
              await supabaseAdmin
                .from("bulk_jobs")
                .update({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  next_send_at: null,
                  failed_count: (job.failed_count ?? 0) + failed,
                })
                .eq("id", job.id);
              summary.completed++;
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


          for (const r of pending) {
            const phone = normalizeWhatsappPhone(r.phone) || "";
            if (!phone || phone.length < 6) {
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({ status: "failed", error_message: "رقم غير صالح", sent_at: new Date().toISOString() })
                .eq("id", r.id);
              failed++;
              continue;
            }

            const rendered = renderTemplate(job.message || "", { name: r.name, phone });
            let errorMessage: string | null = null;
            let providerId: string | null = null;
            let queuedOnly = false;

            try {
              const caption = rendered.trim();
              if (job.image_url) {
                const res = await waBridge.sendMedia(sess.session_id, phone, job.image_url, {
                  caption,
                  mediaType: "image",
                  phone,
                });
                const parsed = acceptedBridgeId(res);
                providerId = parsed.id;
                queuedOnly = parsed.queuedOnly;
              } else {
                const res = await waBridge.sendText(sess.session_id, phone, caption);
                const parsed = acceptedBridgeId(res);
                providerId = parsed.id;
                queuedOnly = parsed.queuedOnly;
              }
            } catch (err) {
              errorMessage = describeErr(err);
              if (/session.*(not.?found|closed|logged.?out|not connected)/i.test(errorMessage)) {
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
            }

            if (errorMessage) {
              failed++;
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "failed",
                  error_message: errorMessage,
                  sent_at: new Date().toISOString(),
                })
                .eq("id", r.id);
            } else if (queuedOnly) {
              // Bridge accepted but did not return a real message id yet.
              // Mark as processing and let the stale-sweep decide later.
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "processing",
                  sent_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq("id", r.id);
            } else {
              sent++;
              await supabaseAdmin
                .from("bulk_job_recipients")
                .update({
                  status: "success",
                  sent_at: new Date().toISOString(),
                })
                .eq("id", r.id);

              // Mirror to wa_messages so it appears in inbox history
              await supabaseAdmin.from("wa_messages").insert({
                user_id: job.user_id,
                session_id: sess.session_id,
                direction: "out",
                remote_jid: `${phone}@s.whatsapp.net`,
                to_phone: phone,
                msg_type: job.image_url ? "image" : "text",
                text_body: rendered,
                media_url: job.image_url ?? null,
                status: "sent",
                provider_message_id: providerId,
              });
            }

            await supabaseAdmin.from("send_log").insert({
              user_id: job.user_id,
              channel: "bulk",
              action: "bulk_send",
              status: errorMessage ? "failed" : queuedOnly ? "pending" : "success",
              title: job.title,
              description: (queuedOnly ? "قيد التأكيد من الجسر — " : "") + rendered.slice(0, 140),
              recipient: `${r.name} (${phone})`,
              error_message: errorMessage,
              metadata: { job_id: job.id, provider_message_id: providerId, queued_only: queuedOnly },
            });
          }


          summary.sent += sent;
          summary.failed += failed;

          const nextAt = new Date(Date.now() + (job.interval_seconds ?? 5) * 1000);
          await supabaseAdmin
            .from("bulk_jobs")
            .update({
              sent_count: (job.sent_count ?? 0) + sent,
              failed_count: (job.failed_count ?? 0) + failed,
              next_send_at: nextAt.toISOString(),
            })
            .eq("id", job.id);
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

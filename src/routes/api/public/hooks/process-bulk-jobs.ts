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
        const acceptedBridgeId = (res: unknown): string => {
          const queuedId = bridgeSendQueuedMessage(res);
          try {
            return assertBridgeSendQueued(res as Parameters<typeof assertBridgeSendQueued>[0]);
          } catch (err) {
            if (queuedId) return queuedId;
            throw err;
          }
        };

        const now = new Date();
        const summary = {
          promoted: 0,
          processed: 0,
          sent: 0,
          failed: 0,
          completed: 0,
          skipped_no_session: 0,
        };

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

          const { data: pending } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("id, name, phone")
            .eq("job_id", job.id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(batchSize);

          if (!pending || pending.length === 0) {
            await supabaseAdmin
              .from("bulk_jobs")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                next_send_at: null,
              })
              .eq("id", job.id);
            summary.completed++;
            continue;
          }

          let sent = 0;
          let failed = 0;

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

            try {
              const caption = rendered.trim();
              if (job.image_url) {
                const res = await waBridge.sendMedia(sess.session_id, phone, job.image_url, {
                  caption,
                  mediaType: "image",
                  phone,
                });
                providerId = acceptedBridgeId(res);
              } else {
                const res = await waBridge.sendText(sess.session_id, phone, caption);
                providerId = acceptedBridgeId(res);
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
              status: errorMessage ? "failed" : "success",
              title: job.title,
              description: rendered.slice(0, 140),
              recipient: `${r.name} (${phone})`,
              error_message: errorMessage,
              metadata: { job_id: job.id, provider_message_id: providerId },
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

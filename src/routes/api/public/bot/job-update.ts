import { createFileRoute } from "@tanstack/react-router";

function authorize(request: Request): Response | null {
  const secret = process.env.BOT_WORKER_SECRET;
  if (!secret) return new Response("Worker secret not configured", { status: 500 });
  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return null;
}

const FACEBOOK_SESSION_REJECTED_RE =
  /SESSION_EXPIRED|Facebook rejected|stored session cookies|redirected to login|login required|checkpoint|c_user|not logged in|Session cookies rejected/i;

export const Route = createFileRoute("/api/public/bot/job-update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorize(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const body = (await request.json().catch(() => null)) as
          | {
              jobId?: string;
              progress?: number;
              processedItems?: number;
              totalItems?: number;
              status?: "completed" | "failed" | "running";
              errorMessage?: string;
              result?: { target?: string; status: "success" | "failed" | "skipped"; data?: unknown; error?: string };
              accountStatus?: { accountId: string; status: "active" | "invalid" | "checkpoint" | "disabled"; error?: string };
            }
          | null;
        if (!body || !body.jobId) return Response.json({ error: "jobId required" }, { status: 400 });

        // Pre-check current job status — if the user cancelled or it's already finished,
        // signal the worker to abort and stop persisting further results/progress.
        const { data: current } = await supabaseAdmin
          .from("fb_jobs")
          .select("status, job_type, account_id, total_items")
          .eq("id", body.jobId)
          .maybeSingle();
        if (body.status === "failed" && /is not implemented in this worker/i.test(body.errorMessage || "")) {
          await supabaseAdmin
            .from("fb_jobs")
            .update({
              status: "pending",
              progress: 0,
              processed_items: 0,
              started_at: null,
              completed_at: null,
              error_message: "تم تجاهل تحديث من Worker قديم وإعادة المهمة للانتظار.",
            } as never)
            .eq("id", body.jobId)
            .eq("status", "running");
          return Response.json({ ok: false, staleWorker: true, message: "Stale worker ignored; job requeued" });
        }
        const terminal = current && (current.status === "cancelled" || current.status === "completed" || current.status === "failed");
        if (terminal) {
          // Still allow account-status writes (those are about the FB account, not the job).
          if (body.accountStatus) {
            await supabaseAdmin
              .from("fb_bot_accounts")
              .update({
                status: body.accountStatus.status,
                last_check_at: new Date().toISOString(),
                last_error: body.accountStatus.error ?? null,
              })
              .eq("id", body.accountStatus.accountId);
          }
          return Response.json({ ok: true, cancelled: current.status === "cancelled", jobStatus: current.status });
        }

        // Optional: insert a result row
        if (body.result) {
          await supabaseAdmin.from("fb_job_results").insert([{
            job_id: body.jobId,
            target: body.result.target ?? null,
            status: body.result.status,
            data: (body.result.data ?? null) as never,
            error: body.result.error ?? null,
          }]);
        }

        // Optional: update account status
        if (body.accountStatus) {
          await supabaseAdmin
            .from("fb_bot_accounts")
            .update({
              status: body.accountStatus.status,
              last_check_at: new Date().toISOString(),
              last_error: body.accountStatus.error ?? null,
            })
            .eq("id", body.accountStatus.accountId);
        }

        // If the worker reports a session rejection but forgot accountStatus,
        // still mark the linked account invalid so the UI stops showing it active.
        if (
          body.status === "failed" &&
          current?.account_id &&
          FACEBOOK_SESSION_REJECTED_RE.test(body.errorMessage || "")
        ) {
          await supabaseAdmin
            .from("fb_bot_accounts")
            .update({
              status: "invalid",
              last_check_at: new Date().toISOString(),
              last_error: body.errorMessage ?? "SESSION_EXPIRED",
            })
            .eq("id", current.account_id);
        }

        // Update job progress / status — but never overwrite a 'cancelled' row.
        const update: Record<string, unknown> = {};
        if (typeof body.progress === "number") update.progress = Math.max(0, Math.min(100, body.progress));
        if (typeof body.processedItems === "number") update.processed_items = body.processedItems;
        if (typeof body.totalItems === "number") update.total_items = Math.max(0, body.totalItems);
        if (body.status) {
          update.status = body.status;
          if (body.status === "completed" || body.status === "failed") {
            update.completed_at = new Date().toISOString();
            update.progress = 100;
            if (
              typeof body.totalItems !== "number" &&
              typeof body.processedItems === "number" &&
              (!current?.total_items || current.total_items <= 0)
            ) {
              update.total_items = Math.max(0, body.processedItems);
            }
          }
          if (body.errorMessage) update.error_message = body.errorMessage;
        }
        if (Object.keys(update).length > 0) {
          await supabaseAdmin
            .from("fb_jobs")
            .update(update as never)
            .eq("id", body.jobId)
            .in("status", ["pending", "running"]); // do not resurrect cancelled/completed/failed
        }

        return Response.json({ ok: true });
      },
    },
  },
});

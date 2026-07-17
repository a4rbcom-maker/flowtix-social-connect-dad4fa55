import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

function authorize(request: Request): Response | null {
  const secret = process.env.BOT_WORKER_SECRET;
  if (!secret) return new Response("Worker secret not configured", { status: 500 });
  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return null;
}

const FACEBOOK_SESSION_REJECTED_RE =
  /SESSION_EXPIRED|Facebook rejected|stored session cookies|redirected to login|login required|checkpoint|c_user|not logged in|Session cookies rejected/i;

function normalizeExtractedPage(result: { target?: string; data?: unknown } | undefined) {
  if (!result) return null;
  const data = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
  const pageId =
    typeof data.id === "string" && data.id.trim()
      ? data.id.trim()
      : typeof result.target === "string"
        ? result.target.trim()
        : "";
  const pageName = typeof data.name === "string" ? data.name.trim() : "";
  const avatar =
    typeof data.avatar_url === "string"
      ? data.avatar_url
      : typeof data.avatarUrl === "string"
        ? data.avatarUrl
        : null;
  if (!pageId || !pageName) return null;
  return {
    page_id: pageId,
    page_name: pageName.slice(0, 200),
    avatar_url: avatar && /^https?:\/\//i.test(avatar) ? avatar : null,
  };
}

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
          .select("status, job_type, account_id, user_id, total_items")
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
        const paused = current?.status === "paused";
        if (terminal || paused) {
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
          // For paused jobs we still want any in-flight result row that the
          // worker just produced to be saved, so it isn't re-sent on resume.
          if (paused && body.result) {
            await supabaseAdmin.from("fb_job_results").insert([{
              job_id: body.jobId,
              target: body.result.target ?? null,
              status: body.result.status,
              data: (body.result.data ?? null) as never,
              error: body.result.error ?? null,
            }]);
          }
          return Response.json({
            ok: true,
            cancelled: current?.status === "cancelled",
            paused,
            jobStatus: current?.status,
          });
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

          if (
            current?.job_type === "extract_pages" &&
            current.user_id &&
            current.account_id &&
            body.result.status === "success"
          ) {
            const extractedPage = normalizeExtractedPage(body.result);
            if (extractedPage) {
              await supabaseAdmin.from("fb_pages").upsert(
                {
                  user_id: current.user_id,
                  page_id: extractedPage.page_id,
                  page_name: extractedPage.page_name,
                  avatar_url: extractedPage.avatar_url,
                  connection_type: "bot",
                  bot_account_id: current.account_id,
                  status: "active",
                  last_error: null,
                } as never,
                { onConflict: "user_id,page_id", ignoreDuplicates: false },
              );
            }
          }
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
              body.status === "completed" &&
              current?.job_type === "extract_pages" &&
              Math.max(body.processedItems ?? 0, current.total_items ?? 0) <= 0
            ) {
              update.status = "failed";
              update.error_message = "لم يتم العثور على أي صفحة في حساب فيسبوك أثناء الاستخراج.";
            }
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
      GET: methodNotAllowedHandler(["POST"]),
      HEAD: methodNotAllowedHandler(["POST"]),
      PUT: methodNotAllowedHandler(["POST"]),
      DELETE: methodNotAllowedHandler(["POST"]),
      PATCH: methodNotAllowedHandler(["POST"]),
    },
  },
});

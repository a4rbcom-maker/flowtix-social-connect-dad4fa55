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

type BotJobResult = {
  target?: string;
  status: "success" | "failed" | "skipped";
  data?: unknown;
  error?: string;
};

async function persistJobResult(
  supabaseAdmin: { from: (table: string) => any },
  input: {
    jobId: string;
    result: BotJobResult;
    current?: { job_type?: string | null; user_id?: string | null; account_id?: string | null } | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error: insertError } = await supabaseAdmin.from("fb_job_results").insert([
    {
      job_id: input.jobId,
      target: input.result.target ?? null,
      status: input.result.status,
      data: (input.result.data ?? null) as never,
      error: input.result.error ?? null,
    },
  ]);
  if (insertError) {
    console.error("[bot/job-update] fb_job_results insert failed", {
      jobId: input.jobId,
      target: input.result.target,
      status: input.result.status,
      message: insertError.message,
    });
    return { ok: false, message: `تعذر حفظ نتيجة الاستخراج في قاعدة البيانات: ${insertError.message}` };
  }

  if (
    input.current?.job_type === "extract_pages" &&
    input.current.user_id &&
    input.current.account_id &&
    input.result.status === "success"
  ) {
    const extractedPage = normalizeExtractedPage(input.result);
    if (extractedPage) {
      const { error: upsertError } = await supabaseAdmin.from("fb_pages").upsert(
        {
          user_id: input.current.user_id,
          page_id: extractedPage.page_id,
          page_name: extractedPage.page_name,
          avatar_url: extractedPage.avatar_url,
          connection_type: "bot",
          bot_account_id: input.current.account_id,
          status: "active",
          last_error: null,
        } as never,
        { onConflict: "user_id,page_id", ignoreDuplicates: false },
      );
      if (upsertError) {
        console.error("[bot/job-update] fb_pages upsert failed", {
          jobId: input.jobId,
          pageId: extractedPage.page_id,
          message: upsertError.message,
        });
        return { ok: false, message: `تم اكتشاف الصفحة لكن تعذر حفظها: ${upsertError.message}` };
      }
    }
  }

  return { ok: true };
}

export const Route = createFileRoute("/api/public/bot/job-update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorize(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const workerCapabilities = (request.headers.get("x-flowtix-worker-capabilities") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const workerName = (request.headers.get("x-flowtix-worker-name") || "vps-worker").slice(0, 80);
        const workerVersion = request.headers.get("x-flowtix-worker-version");
        supabaseAdmin
          .from("bot_worker_heartbeats")
          .upsert(
            {
              worker_name: workerName,
              version: workerVersion,
              capabilities: workerCapabilities,
              last_seen_at: new Date().toISOString(),
              meta: { ua: request.headers.get("user-agent"), source: "job-update" },
            },
            { onConflict: "worker_name" },
          )
          .then(({ error }) => {
            if (error) console.error("heartbeat upsert failed from job-update", error.message);
          });

        const body = (await request.json().catch(() => null)) as
          | {
              jobId?: string;
              progress?: number;
              processedItems?: number;
              totalItems?: number;
              status?: "completed" | "failed" | "running";
              errorMessage?: string;
              result?: BotJobResult;
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
        if (body.result) {
          const persisted = await persistJobResult(supabaseAdmin, {
            jobId: body.jobId,
            result: body.result,
            current,
          });
          if (!persisted.ok) {
            await supabaseAdmin
              .from("fb_jobs")
              .update({
                status: "failed",
                progress: 100,
                completed_at: new Date().toISOString(),
                error_message: persisted.message,
              } as never)
              .eq("id", body.jobId)
              .in("status", ["pending", "running"]);
            return Response.json({ error: persisted.message }, { status: 500 });
          }
        }

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
          // Results are persisted before this branch even for completed/failed
          // jobs, so late successful page candidates are not silently dropped.
          return Response.json({
            ok: true,
            cancelled: current?.status === "cancelled",
            paused,
            jobStatus: current?.status,
          });
        }

        // Optional result rows were already persisted above. From this point on,
        // counters/status updates cannot advance while extracted pages are lost.

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
              update.error_message = "انتهى فحص صفحات فيسبوك بدون أي نتيجة محفوظة. راجع سجل التشخيص لمعرفة آخر مرحلة وصل لها البوت؛ لن يتم اعتبار 0 صفحات نجاحاً.";
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

        // On successful completion of an extract_pages job, purge previously
        // saved bot pages for this account that were NOT discovered in this
        // run. This removes stale entries left over from earlier (looser)
        // extractions so the picker only shows currently managed pages.
        if (
          body.status === "completed" &&
          current?.job_type === "extract_pages" &&
          current.user_id &&
          current.account_id
        ) {
          const { data: results } = await supabaseAdmin
            .from("fb_job_results")
            .select("target,status,data")
            .eq("job_id", body.jobId)
            .eq("status", "success");
          const keepIds = new Set<string>();
          for (const r of results ?? []) {
            const pid = String((r as { data?: { page_id?: string; id?: string } }).data?.page_id
              || (r as { data?: { id?: string } }).data?.id
              || (r as { target?: string }).target
              || "").trim();
            if (pid) keepIds.add(pid);
          }
          if (keepIds.size > 0) {
            const { error: purgeError } = await supabaseAdmin
              .from("fb_pages")
              .delete()
              .eq("user_id", current.user_id)
              .eq("bot_account_id", current.account_id)
              .eq("connection_type", "bot")
              .not("page_id", "in", `(${Array.from(keepIds).map((p) => `"${p.replace(/"/g, '')}"`).join(",")})`);
            if (purgeError) {
              console.error("[bot/job-update] fb_pages purge failed", purgeError.message);
            }
          }
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

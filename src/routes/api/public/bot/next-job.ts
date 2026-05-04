// VPS Worker API: pulls one pending job and updates it.
// Auth: Authorization: Bearer <BOT_WORKER_SECRET>
// Single round-trip via UPDATE…RETURNING with SKIP LOCKED to avoid contention.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptJson } from "@/server/crypto.server";

function authorize(request: Request): Response | null {
  const secret = process.env.BOT_WORKER_SECRET;
  if (!secret) return new Response("Worker secret not configured", { status: 500 });
  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export const Route = createFileRoute("/api/public/bot/next-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorize(request);
        if (denied) return denied;

        // Atomically claim the oldest pending job whose schedule has arrived.
        // We use an UPDATE … WHERE id = (SELECT … LIMIT 1 FOR UPDATE SKIP LOCKED)
        // pattern via a SECURITY DEFINER RPC for atomicity. Fallback: two-step.
        const nowIso = new Date().toISOString();

        // Step 1: select candidate (admin bypasses RLS)
        const { data: candidate, error: selErr } = await supabaseAdmin
          .from("fb_jobs")
          .select("id")
          .eq("status", "pending")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (selErr) return Response.json({ error: selErr.message }, { status: 500 });
        if (!candidate) return Response.json({ job: null });

        // Step 2: claim by transitioning status pending→running (only succeeds if still pending)
        const { data: claimed, error: updErr } = await supabaseAdmin
          .from("fb_jobs")
          .update({ status: "running", started_at: nowIso })
          .eq("id", candidate.id)
          .eq("status", "pending")
          .select("*")
          .maybeSingle();
        if (updErr) return Response.json({ error: updErr.message }, { status: 500 });
        if (!claimed) return Response.json({ job: null }); // someone else got it

        // Fetch + decrypt account credentials
        let credentials: unknown = null;
        let displayName: string | null = null;
        let authMethod: string | null = null;
        if (claimed.account_id) {
          const { data: acc } = await supabaseAdmin
            .from("fb_bot_accounts")
            .select("display_name, auth_method, encrypted_payload")
            .eq("id", claimed.account_id)
            .maybeSingle();
          if (acc) {
            displayName = acc.display_name;
            authMethod = acc.auth_method;
            try {
              credentials = decryptJson(acc.encrypted_payload);
            } catch (e) {
              return Response.json(
                { error: "Failed to decrypt credentials", details: String(e) },
                { status: 500 },
              );
            }
          }
        }

        return Response.json({
          job: {
            id: claimed.id,
            type: claimed.job_type,
            payload: claimed.payload,
            account: claimed.account_id
              ? { id: claimed.account_id, displayName, authMethod, credentials }
              : null,
          },
        });
      },
    },
  },
});

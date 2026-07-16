// Public cron endpoint that runs an incremental Messenger sync for every
// active page across every user. Called hourly by pg_cron. Authenticated via
// the Supabase publishable/anon key (apikey header) — no user session needed
// because this hook opens a fresh admin scope inside its handler.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/messenger-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Validate the caller: require the project's publishable/anon key.
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        const providedKey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!anonKey || providedKey !== anonKey) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Snapshot every (user_id, page_id) with a connected page.
        const { data: pages, error } = await supabaseAdmin
          .from("fb_pages")
          .select("user_id, page_id, page_name, status")
          .eq("status", "active");
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Enqueue a job row per page. The actual sync work runs when the user
        // opens the tab or invokes startMessengerSync (avoids long-running
        // Worker requests). This keeps the cron cheap and safe.
        let enqueued = 0;
        for (const p of pages ?? []) {
          const { data: existing } = await supabaseAdmin
            .from("messenger_sync_jobs")
            .select("id")
            .eq("user_id", p.user_id)
            .eq("page_id", p.page_id)
            .in("status", ["queued", "running"])
            .maybeSingle();
          if (existing) continue;
          const { error: insErr } = await supabaseAdmin
            .from("messenger_sync_jobs")
            .insert({
              user_id: p.user_id,
              page_id: p.page_id,
              page_name: p.page_name,
              status: "queued",
              mode: "incremental",
              triggered_by: "cron",
            });
          if (!insErr) enqueued += 1;
        }

        return new Response(
          JSON.stringify({ ok: true, pagesConsidered: pages?.length ?? 0, enqueued }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

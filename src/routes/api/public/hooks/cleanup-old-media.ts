import { createFileRoute } from "@tanstack/react-router";

const RETENTION_DAYS = 15;

export const Route = createFileRoute("/api/public/hooks/cleanup-old-media")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

          const { data: rows, error: selErr } = await supabaseAdmin
            .from("fb_media_assets")
            .select("id, storage_path")
            .lt("created_at", cutoff)
            .limit(1000);
          if (selErr) throw selErr;

          const list = rows ?? [];
          if (list.length === 0) {
            return new Response(JSON.stringify({ ok: true, removed: 0 }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const paths = list.map((r) => r.storage_path).filter(Boolean);
          if (paths.length > 0) {
            await supabaseAdmin.storage.from("fb-media").remove(paths);
          }

          const ids = list.map((r) => r.id);
          const { error: delErr } = await supabaseAdmin
            .from("fb_media_assets")
            .delete()
            .in("id", ids);
          if (delErr) throw delErr;

          return new Response(
            JSON.stringify({ ok: true, removed: ids.length, cutoff }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "cleanup failed";
          console.error("[cleanup-old-media]", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

// Cleanup thresholds
const QR_ABANDON_MINUTES = 30;         // QR pairing sessions older than this → deleted
const CONNECTED_STALE_HOURS = 6;       // connected sessions with no heartbeat for this long → disconnected
const DISCONNECTED_TO_LOGGED_OUT_DAYS = 7; // disconnected sessions untouched this long → logged_out (prompts reconnect UI)

export const Route = createFileRoute("/api/public/hooks/cleanup-wa-sessions")({
  server: {
    handlers: {
      POST: async () => {
        const started = Date.now();
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const qrCutoff = new Date(Date.now() - QR_ABANDON_MINUTES * 60 * 1000).toISOString();
          const staleCutoff = new Date(Date.now() - CONNECTED_STALE_HOURS * 60 * 60 * 1000).toISOString();
          const logoutCutoff = new Date(Date.now() - DISCONNECTED_TO_LOGGED_OUT_DAYS * 24 * 60 * 60 * 1000).toISOString();

          // 1) Delete abandoned QR sessions
          const { data: qrRows, error: qrSelErr } = await supabaseAdmin
            .from("wa_sessions")
            .select("id, user_id")
            .eq("status", "qr")
            .lt("updated_at", qrCutoff)
            .limit(500);
          if (qrSelErr) throw qrSelErr;

          let qrDeleted = 0;
          if (qrRows && qrRows.length > 0) {
            const ids = qrRows.map((r) => r.id);
            const { error: qrDelErr } = await supabaseAdmin
              .from("wa_sessions")
              .delete()
              .in("id", ids);
            if (qrDelErr) throw qrDelErr;
            qrDeleted = ids.length;
          }

          // 2) Demote stale "connected" sessions with no heartbeat to "disconnected"
          // Skip users that have an active bulk job (avoid interfering with sends in flight).
          const { data: staleRows, error: staleSelErr } = await supabaseAdmin
            .from("wa_sessions")
            .select("id, user_id, last_seen_at, updated_at")
            .eq("status", "connected")
            .or(`last_seen_at.is.null,last_seen_at.lt.${staleCutoff}`)
            .lt("updated_at", staleCutoff)
            .limit(500);
          if (staleSelErr) throw staleSelErr;

          let staleDemoted = 0;
          if (staleRows && staleRows.length > 0) {
            const userIds = Array.from(new Set(staleRows.map((r) => r.user_id)));
            const { data: activeJobs } = await supabaseAdmin
              .from("bulk_jobs")
              .select("user_id")
              .in("user_id", userIds)
              .in("status", ["running", "scheduled"]);
            const busy = new Set((activeJobs ?? []).map((r) => r.user_id));

            const eligible = staleRows.filter((r) => !busy.has(r.user_id)).map((r) => r.id);
            if (eligible.length > 0) {
              const { error: updErr } = await supabaseAdmin
                .from("wa_sessions")
                .update({ status: "disconnected", updated_at: new Date().toISOString() })
                .in("id", eligible);
              if (updErr) throw updErr;
              staleDemoted = eligible.length;
            }
          }

          // 3) Convert long-disconnected sessions to logged_out so the UI nudges reconnect
          const { data: oldDiscRows, error: oldSelErr } = await supabaseAdmin
            .from("wa_sessions")
            .select("id")
            .eq("status", "disconnected")
            .lt("updated_at", logoutCutoff)
            .limit(500);
          if (oldSelErr) throw oldSelErr;

          let markedLoggedOut = 0;
          if (oldDiscRows && oldDiscRows.length > 0) {
            const ids = oldDiscRows.map((r) => r.id);
            const { error: updErr } = await supabaseAdmin
              .from("wa_sessions")
              .update({ status: "logged_out", updated_at: new Date().toISOString() })
              .in("id", ids);
            if (updErr) throw updErr;
            markedLoggedOut = ids.length;
          }

          // 4) Purge orphan sessions on the connection server that no longer
          // exist in wa_sessions. These "ghost" sessions keep emitting QR
          // events every few seconds and starve real message deliveries.
          let bridgeOrphansDeleted = 0;
          let bridgeOrphansFailed = 0;
          try {
            const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
            const apiKey = process.env.WA_BRIDGE_API_KEY || "";
            if (bridgeUrl && apiKey) {
              const { data: allRows } = await supabaseAdmin
                .from("wa_sessions")
                .select("session_id");
              const known = new Set((allRows ?? []).map((r) => String(r.session_id)));
              if (known.size > 0) {
                const listRes = await fetch(`${bridgeUrl}/api/sessions`, {
                  headers: { "x-api-key": apiKey, Accept: "application/json" },
                });
                const listText = await listRes.text();
                let listBody: unknown; try { listBody = JSON.parse(listText); } catch { listBody = listText; }
                const list: Array<Record<string, unknown>> = Array.isArray(listBody)
                  ? (listBody as Array<Record<string, unknown>>)
                  : Array.isArray((listBody as { sessions?: unknown })?.sessions)
                    ? ((listBody as { sessions: Array<Record<string, unknown>> }).sessions)
                    : [];
                for (const s of list) {
                  const id = String(s.id ?? s.sessionId ?? "");
                  if (!id || known.has(id)) continue;
                  try {
                    const dr = await fetch(`${bridgeUrl}/api/sessions/${encodeURIComponent(id)}`, {
                      method: "DELETE",
                      headers: { "x-api-key": apiKey, Accept: "application/json" },
                    });
                    if (dr.ok) bridgeOrphansDeleted += 1;
                    else bridgeOrphansFailed += 1;
                  } catch {
                    bridgeOrphansFailed += 1;
                  }
                }
              }
            }
          } catch (e) {
            console.warn("[cleanup-wa-sessions] bridge orphan purge failed:", e instanceof Error ? e.message : String(e));
          }

          const durationMs = Date.now() - started;
          console.log("[cleanup-wa-sessions]", { qrDeleted, staleDemoted, markedLoggedOut, bridgeOrphansDeleted, bridgeOrphansFailed, durationMs });

          return new Response(
            JSON.stringify({
              ok: true,
              qr_deleted: qrDeleted,
              stale_demoted: staleDemoted,
              marked_logged_out: markedLoggedOut,
              bridge_orphans_deleted: bridgeOrphansDeleted,
              bridge_orphans_failed: bridgeOrphansFailed,
              duration_ms: durationMs,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "cleanup failed";
          console.error("[cleanup-wa-sessions]", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: methodNotAllowedHandler(["POST"]),
      HEAD: methodNotAllowedHandler(["POST"]),
      PUT: methodNotAllowedHandler(["POST"]),
      DELETE: methodNotAllowedHandler(["POST"]),
      PATCH: methodNotAllowedHandler(["POST"]),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

// Cleanup thresholds
const QR_ABANDON_MINUTES = 30;         // QR pairing sessions older than this → deleted
const DISCONNECTED_TO_LOGGED_OUT_DAYS = 7; // disconnected sessions untouched this long → logged_out (prompts reconnect UI)

export const Route = createFileRoute("/api/public/hooks/cleanup-wa-sessions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        try {
          const secret = process.env.CRON_SECRET || process.env.BOT_WORKER_SECRET;
          if (!secret) {
            return new Response("Worker secret not configured", { status: 500 });
          }
          const auth = request.headers.get("authorization");
          if (!auth || auth !== `Bearer ${secret}`) {
            return new Response("Unauthorized", { status: 401 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const qrCutoff = new Date(Date.now() - QR_ABANDON_MINUTES * 60 * 1000).toISOString();
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

          // 2) Never demote connected sessions from this cleanup job.
          // A missing heartbeat can mean the app did not poll recently, not that
          // WhatsApp is logged out. The bridge webhook/status checks are the only
          // authority allowed to move connected → disconnected/QR.
          let staleDemoted = 0;

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
          let liveDisconnected = 0;
          let bridgeOrphansDeleted = 0;
          let bridgeOrphansFailed = 0;
          try {
            const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
            const apiKey = process.env.WA_BRIDGE_API_KEY || "";
            if (bridgeUrl && apiKey) {
              const { data: connectedRows } = await supabaseAdmin
                .from("wa_sessions")
                .select("id, user_id, session_id, status")
                .eq("status", "connected")
                .limit(100);
              for (const row of connectedRows ?? []) {
                const sessionId = String(row.session_id ?? "");
                if (!sessionId) continue;
                let nextStatus: "connected" | "disconnected" | null = null;
                let reason = "";
                let rawStatus = "";
                try {
                  const statusRes = await fetch(`${bridgeUrl}/api/sessions/${encodeURIComponent(sessionId)}/status`, {
                    headers: { "x-api-key": apiKey, Accept: "application/json" },
                  });
                  const statusText = await statusRes.text();
                  let statusBody: unknown;
                  try { statusBody = JSON.parse(statusText); } catch { statusBody = statusText; }
                  const rec = statusBody && typeof statusBody === "object" ? statusBody as Record<string, unknown> : {};
                  rawStatus = String(rec.status ?? rec.state ?? statusRes.status);
                  const isConnected = rec.connected === true || /connected|open|ready|authenticated/i.test(rawStatus);
                  const isMissing = statusRes.status === 404 || /not.?found|missing|unknown session/i.test(statusText);
                  if (isConnected) nextStatus = "connected";
                  else if (isMissing || /disconnected|closed|logged.?out|qr/i.test(rawStatus)) {
                    nextStatus = "disconnected";
                    reason = isMissing ? `bridge_session_missing:${statusRes.status}` : `bridge_session_not_live:${rawStatus}`;
                  }
                } catch (err) {
                  // Network/timeout errors are not proof of logout; leave status unchanged.
                  reason = `bridge_status_probe_failed:${err instanceof Error ? err.message : String(err)}`;
                }
                if (nextStatus === "disconnected") {
                  await supabaseAdmin
                    .from("wa_sessions")
                    .update({ status: "disconnected", updated_at: new Date().toISOString() })
                    .eq("id", row.id);
                  await supabaseAdmin
                    .from("whatsapp_settings")
                    .update({ is_connected: false, last_connected_at: null })
                    .eq("user_id", row.user_id);
                  await supabaseAdmin.from("wa_session_events").insert({
                    user_id: row.user_id,
                    session_id: sessionId,
                    from_status: row.status ?? "connected",
                    to_status: "disconnected",
                    source: "poll_error",
                    reason,
                    raw_status: rawStatus || "disconnected",
                    bridge_event: "cleanup_live_status_probe",
                  });
                  liveDisconnected += 1;
                }
              }

              const { data: allRows } = await supabaseAdmin
                .from("wa_sessions")
                .select("session_id");
              const known = new Set((allRows ?? []).map((r) => String(r.session_id)).filter(Boolean));
              for (let round = 0; round < 5; round++) {
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
                const deleteBridgeSession = async (id: string) => {
                  const encoded = encodeURIComponent(id);
                  const attempts = [
                    { method: "POST", path: `/api/sessions/${encoded}/logout` },
                    { method: "DELETE", path: `/api/sessions/${encoded}` },
                    { method: "DELETE", path: `/api/sessions/${encoded}?purge=true&force=true` },
                  ];
                  let ok = false;
                  for (const attempt of attempts) {
                    try {
                      const dr = await fetch(`${bridgeUrl}${attempt.path}`, {
                        method: attempt.method,
                        headers: { "x-api-key": apiKey, Accept: "application/json" },
                      });
                      if (dr.ok || dr.status === 404) ok = true;
                    } catch {
                      // try next deletion shape
                    }
                  }
                  return ok;
                };

                let deletedThisRound = 0;
                for (const s of list) {
                  const id = String(s.id ?? s.sessionId ?? "");
                  if (!id || known.has(id)) continue;
                  try {
                    const deleted = await deleteBridgeSession(id);
                    if (deleted) {
                      bridgeOrphansDeleted += 1;
                      deletedThisRound += 1;
                    }
                    else bridgeOrphansFailed += 1;
                  } catch {
                    bridgeOrphansFailed += 1;
                  }
                }
                if (deletedThisRound === 0) break;
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
              live_disconnected: liveDisconnected,
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

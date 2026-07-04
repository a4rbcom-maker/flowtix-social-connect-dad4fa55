import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

// Maintenance: delete bridge sessions that no longer exist in wa_sessions.
// These "ghost" sessions keep emitting QR events and starve the bridge from
// forwarding real message deliveries. Requires CRON_SECRET.
export const Route = createFileRoute("/api/public/wa-bridge-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("confirm") !== "1") {
          return json({ ok: false, error: "missing_confirm" }, 400);
        }
        const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
        const apiKey = process.env.WA_BRIDGE_API_KEY || "";
        if (!bridgeUrl || !apiKey) return json({ ok: false, error: "missing_bridge_config" }, 500);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows, error } = await supabaseAdmin
          .from("wa_sessions")
          .select("session_id");
        if (error) return json({ ok: false, error: error.message }, 500);
        if (!rows || rows.length === 0) return json({ ok: false, error: "no_known_sessions_refuse_to_delete" }, 500);
        const known = new Set(rows.map((r) => String(r.session_id)));

        const listRes = await fetch(`${bridgeUrl}/api/sessions`, {
          headers: { "x-api-key": apiKey, Accept: "application/json" },
        });
        const listText = await listRes.text();
        let listBody: unknown; try { listBody = JSON.parse(listText); } catch { listBody = listText; }
        const sessions = extractSessions(listBody);

        const deleted: string[] = [];
        const failed: Array<{ id: string; status: number; body: string }> = [];
        for (const s of sessions) {
          const id = String((s as { id?: unknown; sessionId?: unknown }).id ?? (s as { sessionId?: unknown }).sessionId ?? "");
          if (!id || known.has(id)) continue;
          try {
            const dr = await fetch(`${bridgeUrl}/api/sessions/${encodeURIComponent(id)}`, {
              method: "DELETE",
              headers: { "x-api-key": apiKey, Accept: "application/json" },
            });
            if (dr.ok) deleted.push(id);
            else failed.push({ id, status: dr.status, body: (await dr.text()).slice(0, 200) });
          } catch (err) {
            failed.push({ id, status: 0, body: err instanceof Error ? err.message : String(err) });
          }
        }
        return json({ ok: true, total: sessions.length, known: known.size, deleted, failed }, 200);
      },
      GET: methodNotAllowedHandler(["POST"]),
      HEAD: methodNotAllowedHandler(["POST"]),
      PUT: methodNotAllowedHandler(["POST"]),
      DELETE: methodNotAllowedHandler(["POST"]),
      PATCH: methodNotAllowedHandler(["POST"]),
    },
  },
});

function extractSessions(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === "object") {
    const s = (v as { sessions?: unknown }).sessions;
    if (Array.isArray(s)) return s as Array<Record<string, unknown>>;
  }
  return [];
}
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

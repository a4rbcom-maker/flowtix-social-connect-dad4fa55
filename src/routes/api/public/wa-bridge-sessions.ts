import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

// Diagnostic: returns bridge sessions + configured webhook URLs. Read-only.
// Public — only exposes non-secret operational metadata (session id prefix,
// connection state, tenantId, webhookUrl) needed to debug delivery loss.
export const Route = createFileRoute("/api/public/wa-bridge-sessions")({
  server: {
    handlers: {
      GET: async () => {
        const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
        const apiKey = process.env.WA_BRIDGE_API_KEY || "";
        if (!bridgeUrl || !apiKey) {
          return json({ ok: false, error: "missing_bridge_config" }, 500);
        }
        try {
          const r = await fetch(`${bridgeUrl}/api/sessions`, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
          const raw = await r.text();
          const parsed = safeParse(raw) as Record<string, unknown> | unknown[] | string;
          const sessions = extractSessions(parsed);
          const summary = sessions.map((s) => ({
            id: maskId(String(s.id ?? s.sessionId ?? "")),
            connected: Boolean(s.connected),
            status: s.status ?? null,
            tenantId: s.tenantId ?? null,
            phone: s.phone ?? s.phoneNumber ?? null,
            webhookUrl: s.webhookUrl ?? s.webhook ?? null,
            lastSeen: s.lastSeen ?? s.last_seen ?? null,
          }));
          return json({ ok: r.ok, status: r.status, count: sessions.length, sessions: summary }, 200);
        } catch (err) {
          return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
        }
      },
      HEAD: methodNotAllowedHandler(["GET"]),
      POST: methodNotAllowedHandler(["GET"]),
      PUT: methodNotAllowedHandler(["GET"]),
      DELETE: methodNotAllowedHandler(["GET"]),
      PATCH: methodNotAllowedHandler(["GET"]),
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
function maskId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function safeParse(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

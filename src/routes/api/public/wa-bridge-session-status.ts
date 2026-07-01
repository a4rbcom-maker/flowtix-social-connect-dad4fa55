import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wa-bridge-session-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") || "";
        if (!id) return json({ ok: false, error: "missing_id" }, 400);
        const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
        const apiKey = process.env.WA_BRIDGE_API_KEY || "";
        if (!bridgeUrl || !apiKey) return json({ ok: false, error: "missing_bridge_config" }, 500);
        const paths = [
          `/api/sessions/${encodeURIComponent(id)}`,
          `/api/sessions/${encodeURIComponent(id)}/status`,
          `/api/sessions/${encodeURIComponent(id)}/info`,
        ];
        const out: Record<string, unknown> = {};
        for (const p of paths) {
          try {
            const r = await fetch(`${bridgeUrl}${p}`, {
              headers: { "x-api-key": apiKey, Accept: "application/json" },
            });
            const raw = await r.text();
            out[p] = { status: r.status, body: safeParse(raw) };
          } catch (err) {
            out[p] = { error: err instanceof Error ? err.message : String(err) };
          }
        }
        return json({ ok: true, id, out }, 200);
      },
    },
  },
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}
function safeParse(t: string): unknown { try { return JSON.parse(t); } catch { return t; } }

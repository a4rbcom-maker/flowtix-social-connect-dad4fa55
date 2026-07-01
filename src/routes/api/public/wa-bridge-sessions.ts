import { createFileRoute } from "@tanstack/react-router";

// Diagnostic: returns bridge sessions + configured webhook URLs. Read-only.
// Requires ?key=<BOT_WORKER_SECRET> to prevent public exposure.
export const Route = createFileRoute("/api/public/wa-bridge-sessions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key") || request.headers.get("x-diag-key") || "";
        const expected = process.env.BOT_WORKER_SECRET || process.env.FB_PEOPLE_INGEST_SECRET || "";
        if (!expected || key !== expected) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
        const apiKey = process.env.WA_BRIDGE_API_KEY || "";
        if (!bridgeUrl || !apiKey) {
          return new Response(JSON.stringify({ ok: false, error: "missing_bridge_config" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const r = await fetch(`${bridgeUrl}/api/sessions`, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
          const body = await r.text();
          return new Response(
            JSON.stringify({ ok: r.ok, status: r.status, body: safeParse(body) }, null, 2),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

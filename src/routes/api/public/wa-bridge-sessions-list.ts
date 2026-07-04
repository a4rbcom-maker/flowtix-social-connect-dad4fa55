import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

export const Route = createFileRoute("/api/public/wa-bridge-sessions-list")({
  server: {
    handlers: {
      GET: async () => {
        const bridgeUrl = process.env.WA_BRIDGE_URL?.replace(/\/+$/, "") || "";
        const apiKey = process.env.WA_BRIDGE_API_KEY || "";
        if (!bridgeUrl || !apiKey) return json({ ok: false, error: "missing_bridge_config" }, 500);
        try {
          const r = await fetch(`${bridgeUrl}/api/sessions`, {
            headers: { "x-api-key": apiKey, Accept: "application/json" },
          });
          const text = await r.text();
          let body: unknown;
          try { body = JSON.parse(text); } catch { body = text; }
          return json({ ok: true, status: r.status, body }, 200);
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

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
}

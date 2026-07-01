import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/wa/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleWaWebhook } = await import("@/lib/wa-webhook.server");
        return handleWaWebhook(request);
      },
      GET: async () =>
        new Response(
          JSON.stringify({ ok: true, endpoint: "wa-webhook", alias: "wa/webhook", method: "POST" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, x-bridge-signature, x-hub-signature-256, x-signature, x-webhook-signature, x-session-id, x-instance-id",
            "Access-Control-Max-Age": "86400",
          },
        }),
    },
  },
});
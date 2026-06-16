import { createFileRoute } from "@tanstack/react-router";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/public/wa-bridge-health")({
  server: {
    handlers: {
      GET: async () => {
        const { doPing } = await import("@/lib/wa-helpers.server");
        const health = await doPing();

        return new Response(
          JSON.stringify({
            ok: health.ok,
            status: health.status,
            version: health.version,
            latencyMs: health.latencyMs,
            hasApiKey: health.hasApiKey,
            apiKeyName: health.apiKeyName,
            hasWebhookSecret: health.hasWebhookSecret,
            error: health.error,
          }),
          { status: health.ok ? 200 : 500, headers },
        );
      },
      OPTIONS: async () => new Response(null, { status: 204, headers }),
    },
  },
});
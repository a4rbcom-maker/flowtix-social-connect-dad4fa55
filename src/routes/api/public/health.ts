import { createFileRoute } from "@tanstack/react-router";

/**
 * Public health-check endpoint.
 * Used by the deployment smoke test and external uptime monitors.
 * Returns 200 + JSON when the SSR app is alive. No DB calls, no PII.
 */
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          {
            status: "ok",
            service: "flowtixtools-web",
            timestamp: new Date().toISOString(),
            uptime_seconds: Math.round(process.uptime?.() ?? 0),
          },
          {
            status: 200,
            headers: {
              "Cache-Control": "no-store, max-age=0",
              "Content-Type": "application/json",
            },
          },
        );
      },
    },
  },
});

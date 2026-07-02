import { createFileRoute } from "@tanstack/react-router";
import { methodNotAllowedHandler } from "@/lib/http-method-not-allowed";

export const Route = createFileRoute("/api/public/wa-client")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleWaClientApi } = await import("@/lib/wa-client-api.server");
        return handleWaClientApi(request);
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
          },
        }),
      GET: methodNotAllowedHandler(["POST", "OPTIONS"]),
      HEAD: methodNotAllowedHandler(["POST", "OPTIONS"]),
      PUT: methodNotAllowedHandler(["POST", "OPTIONS"]),
      DELETE: methodNotAllowedHandler(["POST", "OPTIONS"]),
      PATCH: methodNotAllowedHandler(["POST", "OPTIONS"]),
    },
  },
});
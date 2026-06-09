// Backwards-compatible alias for /api/public/wa-webhook.
import { createFileRoute } from "@tanstack/react-router";
import { handleWaWebhook } from "@/lib/wa-webhook.server";

export const Route = createFileRoute("/api/public/wa/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWaWebhook(request),
    },
  },
});

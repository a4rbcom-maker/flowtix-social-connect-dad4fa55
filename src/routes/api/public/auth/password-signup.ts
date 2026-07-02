import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/auth/password-signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePasswordSignup } = await import("@/lib/auth-proxy.server");
        return handlePasswordSignup(request);
      },
      OPTIONS: async () => {
        const { handleAuthOptions } = await import("@/lib/auth-proxy.server");
        return handleAuthOptions();
      },
      GET: async () =>
        new Response(JSON.stringify({ ok: true, endpoint: "password-signup", method: "POST" }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
    },
  },
});

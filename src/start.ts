import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { reauthOnExpiredSession } from "@/lib/reauth-middleware";

// Polyfill global WebSocket on Node.js < 22 (SSR runtime only). Required by
// @supabase/realtime-js which expects a native WebSocket constructor.
// Guarded by import.meta.env.SSR so the `ws` import is stripped from the client bundle.
if (import.meta.env.SSR && typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  import("ws").then((mod: any) => {
    (globalThis as { WebSocket?: unknown }).WebSocket = mod.WebSocket ?? mod.default;
  }).catch(() => { /* ws not available */ });
}

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));

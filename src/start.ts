import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Polyfill global WebSocket on Node.js < 22 (server runtime). Required by
// @supabase/realtime-js which expects a native WebSocket constructor.
if (typeof globalThis !== "undefined" && typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  try {
    // Dynamic require so it never leaks to the browser bundle.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WebSocket: NodeWebSocket } = require("ws");
    (globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket;
  } catch {
    // ws not available (e.g. edge runtime) — ignore.
  }
}

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));

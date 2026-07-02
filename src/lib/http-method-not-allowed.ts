// Shared 405 Method Not Allowed responder for API routes.
// Returns a safe JSON body with the RFC 7231 `Allow` header so probes,
// crawlers, and misconfigured callers never trigger a Runtime Error.

export function methodNotAllowed(allowed: string[]): Response {
  const allow = Array.from(new Set(allowed.map((m) => m.toUpperCase()))).join(", ");
  return new Response(
    JSON.stringify({ ok: false, error: "method_not_allowed", allowed: allow }),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: allow,
        "Cache-Control": "no-store",
      },
    },
  );
}

// Convenience factory for a handler that only responds with 405.
export function methodNotAllowedHandler(allowed: string[]) {
  return async () => methodNotAllowed(allowed);
}

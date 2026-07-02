import "./lib/error-capture";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, context: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function readDeployVersion() {
  try {
    const [{ existsSync, readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const filePath = resolve(process.cwd(), "deploy-version.json");
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object") return { ...parsed, source: "file" };
    }
  } catch {
    // Fall through to env fallback.
  }
  const sha = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || "development";
  return {
    sha,
    short_sha: sha === "development" ? "dev" : sha.slice(0, 7),
    run_id: process.env.DEPLOY_RUN_ID || process.env.GITHUB_RUN_ID || null,
    repo: process.env.DEPLOY_REPOSITORY || process.env.GITHUB_REPOSITORY || null,
    deployed_at: process.env.DEPLOYED_AT || new Date().toISOString(),
    mode: "ssr",
    status: "ok",
    source: "env",
  };
}

async function nativeHealthResponse(request: Request) {
  const body = JSON.stringify({
    status: "ok",
    service: process.env.APP_NAME || "flowtixtools-web",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime?.() ?? 0),
    build: await readDeployVersion(),
  });
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0" },
  });
}

function methodNotAllowedResponse(allowed: string[]) {
  return Response.json(
    { ok: false, error: "method_not_allowed", allowed },
    {
      status: 405,
      headers: {
        allow: allowed.join(", "),
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}

function apiRouteMethodFallback(request: Request): Response | null {
  const { pathname: rawPathname } = new URL(request.url);
  const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : rawPathname;
  const method = request.method.toUpperCase();

  const routeMethods: Record<string, string[]> = {
    "/api/public/health": ["GET", "HEAD"],
    "/api/public/wa-webhook": ["GET", "POST", "OPTIONS"],
    "/api/public/wa-client": ["POST", "OPTIONS"],
    "/api/public/wa-bridge-health": ["GET", "OPTIONS"],
    "/api/public/wa-bridge-sessions": ["GET"],
    "/api/public/wa-bridge-session-status": ["GET"],
    "/api/public/fb-people-ingest": ["POST"],
    "/api/public/webhooks/facebook": ["GET", "POST"],
    "/api/public/hooks/process-bulk-jobs": ["POST"],
    "/api/public/hooks/cleanup-old-media": ["POST"],
    "/api/public/bot/next-job": ["POST"],
    "/api/public/bot/job-update": ["POST"],
  };

  const allowed = routeMethods[pathname];
  if (!allowed) {
    if (pathname.startsWith("/api/")) {
      return Response.json(
        { ok: false, error: "not_found", path: rawPathname },
        { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
      );
    }
    return null;
  }

  // TanStack Start does not always synthesize HEAD from GET for server route
  // handlers. If a crawler / proxy / browser preflight sends HEAD to a route
  // that only defines GET, the framework may surface:
  // "forgot to return a response from your server route handler".
  // Answer it here so every matched API request always receives a Response.
  if (method === "HEAD" && allowed.includes("GET")) {
    return new Response(null, {
      status: 200,
      headers: {
        allow: Array.from(new Set([...allowed, "HEAD"])).join(", "),
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  if (allowed.includes(method)) return null;
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: allowed.join(", "),
        "access-control-allow-origin": "*",
        "access-control-allow-methods": allowed.join(", "),
        "access-control-allow-headers": "Content-Type, Authorization",
        "access-control-max-age": "86400",
      },
    });
  }

  return methodNotAllowedResponse(allowed);
}

function isNoRouteResponseError(error: unknown) {
  return error instanceof Error && error.message.includes("forgot to return a response from your server route handler");
}

function noRouteResponseFallback(request: Request) {
  const { pathname: rawPathname } = new URL(request.url);
  const pathname = rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : rawPathname;
  console.warn("[server] route handler returned no response", {
    method: request.method,
    pathname,
  });

  if (pathname.startsWith("/api/")) {
    return Response.json(
      { ok: false, error: "not_found", path: pathname },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }

  return new Response(renderErrorPage(), {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0" },
  });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (module) => (module.default ?? module) as ServerEntry,
    );
  }

  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(response: Response, request: Request): Promise<Response> {
  if (response.status < 500) return response;

  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/")) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/plain") || !contentType.includes("text/html")) {
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text().catch(() => "");
  const isHiddenSsrError = body.includes('"unhandled":true') && body.includes('"message":"HTTPError"');
  if (!isHiddenSsrError) return response;

  console.error(consumeLastCapturedError() ?? new Error(`SSR handler returned hidden HTTPError: ${body}`));

  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, context: unknown) {
    try {
      const url = new URL(request.url);
      const apiFallback = apiRouteMethodFallback(request);
      if (apiFallback) return apiFallback;
      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/api/public/health") return nativeHealthResponse(request);
        if (url.pathname === "/deploy-version.json") {
          const body = JSON.stringify(await readDeployVersion());
          return new Response(request.method === "HEAD" ? null : body, {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0" },
          });
        }
      }
      const handler = await getServerEntry();
      const isHead = request.method === "HEAD";
      const response = await handler.fetch(request, env, context);
      const normalized = await normalizeCatastrophicSsrResponse(response, request);
      if (isHead) {
        return new Response(null, {
          status: normalized.status,
          statusText: normalized.statusText,
          headers: normalized.headers,
        });
      }
      return normalized;
    } catch (error) {
      if (isNoRouteResponseError(error)) return noRouteResponseFallback(request);
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
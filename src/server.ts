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

function cloneHeadRequestAsGet(request: Request): Request {
  return new Request(request.url, {
    method: "GET",
    headers: new Headers(request.headers),
  });
}

export default {
  async fetch(request: Request, env: unknown, context: unknown) {
    try {
      const url = new URL(request.url);
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
      const normalizedRequest = isHead ? cloneHeadRequestAsGet(request) : request;
      const response = await handler.fetch(normalizedRequest, env, context);
      if (isHead) {
        const normalized = await normalizeCatastrophicSsrResponse(response, normalizedRequest);
        return new Response(null, {
          status: normalized.status,
          statusText: normalized.statusText,
          headers: normalized.headers,
        });
      }
      return await normalizeCatastrophicSsrResponse(response, normalizedRequest);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
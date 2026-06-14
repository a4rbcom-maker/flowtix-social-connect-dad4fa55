import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { extname, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createAlertManager } from "./server-alerts.mjs";

function renderSsrFallbackPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flowtix Tools — خطأ مؤقت</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf8ff;color:#1b1428;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{width:min(92vw,560px);padding:40px 28px;text-align:center}
      h1{margin:0 0 12px;font-size:28px;line-height:1.25}
      p{margin:0 0 24px;color:#594a6d;line-height:1.8}
      .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
      a,button{border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}
      button{background:#8b3ff6;color:white}
      a{background:#eee8fb;color:#2c164b}
    </style>
  </head>
  <body>
    <main>
      <h1>حدث خطأ مؤقت</h1>
      <p>الخادم شغّال لكن حصل خطأ داخلي أثناء عرض الصفحة. جرّب التحديث الآن.</p>
      <div class="actions">
        <button onclick="location.reload()">تحديث الصفحة</button>
        <a href="/deploy-version.json">نسخة النشر</a>
      </div>
    </main>
  </body>
</html>`;
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || (process.env[key] !== undefined && process.env[key] !== "")) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const port = Number(process.env.PORT || process.env.APP_PORT || 3001);
const root = process.cwd();
const clientRoot = resolve(root, "dist/client");
const versionFilePath = resolve(root, "deploy-version.json");
const alerts = createAlertManager({ root });
let ssrHandlerPromise;

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").split(",")[0].trim();
}

function requestTarget(req) {
  const raw = typeof req.url === "string" && req.url ? req.url : "/";
  if (raw === "*") return "/";
  let target = raw;
  if (/^https?:\/\//i.test(target)) {
    try {
      const parsed = new URL(target);
      target = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return "/";
    }
  }
  if (!target.startsWith("/")) target = `/${target}`;
  return target.replace(/^\/{2,}/, "/") || "/";
}

function requestOrigin(req) {
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) || "http";
  const safeProto = proto === "https" ? "https" : "http";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || firstHeaderValue(req.headers.host) || `127.0.0.1:${port}`;
  return `${safeProto}://${host}`;
}

function absoluteRequestUrl(req) {
  return `${requestOrigin(req)}${requestTarget(req)}`;
}

// Source of truth = deploy-version.json on disk. We re-read it each request
// (it's tiny and only written on deploy) so PM2 doesn't have to be restarted
// for the version endpoint to reflect the freshly-rsynced bundle. Env vars
// are kept as a fallback only for local dev where no version file exists.
function readDeployVersion() {
  try {
    if (existsSync(versionFilePath)) {
      const raw = readFileSync(versionFilePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return { ...parsed, source: "file" };
    }
  } catch {
    // fall through to env
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

process.on("unhandledRejection", (error) => {
  void alerts.notify({ kind: "process-unhandled-rejection", error });
});

process.on("uncaughtException", (error) => {
  alerts.notify({ kind: "process-uncaught-exception", error })
    .finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
});

async function getSsrHandler() {
  if (!ssrHandlerPromise) {
    const candidates = [
      process.env.SERVER_ENTRY,
      "dist/server/server.js",
      "dist/server/server.mjs",
      "dist/server/index.js",
      "dist/server/index.mjs",
    ].filter(Boolean);
    const entry = candidates.find((candidate) => existsSync(resolve(root, candidate)));
    if (!entry) {
      throw new Error(
        `SSR entry missing. Checked: ${candidates.join(", ")}`,
      );
    }
    ssrHandlerPromise = import(pathToFileURL(resolve(root, entry)).toString())
      .then((module) => module.default ?? module);
  }
  return ssrHandlerPromise;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getStaticFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const safePath = normalize(decoded).replace(/^([/\\])+/, "");
  const filePath = resolve(clientRoot, safePath);
  if (!filePath.startsWith(clientRoot + "/")) return null;
  if (!existsSync(filePath)) return null;
  const stats = statSync(filePath);
  if (!stats.isFile()) return null;
  return { filePath, stats };
}

function serveStatic(req, res, pathname) {
  const file = getStaticFile(pathname);
  if (!file) return false;

  res.statusCode = 200;
  res.setHeader("content-type", mimeTypes[extname(file.filePath)] || "application/octet-stream");
  res.setHeader("content-length", String(file.stats.size));
  if (pathname.startsWith("/assets/")) {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("cache-control", "public, max-age=300");
  }

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  createReadStream(file.filePath).pipe(res);
  return true;
}

function toFetchRequest(req, methodOverride = req.method) {
  const url = absoluteRequestUrl(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  if (methodOverride !== req.method) headers.set("x-flowtix-original-method", req.method || "");

  const init = { method: methodOverride, headers };
  if (methodOverride !== "GET" && methodOverride !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeFetchResponse(fetchResponse, res, { omitBody = false } = {}) {
  res.statusCode = fetchResponse.status;
  res.statusMessage = fetchResponse.statusText;

  const setCookies = typeof fetchResponse.headers.getSetCookie === "function"
    ? fetchResponse.headers.getSetCookie()
    : [];

  fetchResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);

  if (omitBody || !fetchResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(fetchResponse.body).pipe(res);
}

async function alertOnServerError(fetchResponse, request) {
  if (fetchResponse.status < 500) return;

  const url = new URL(request.url);
  const contentType = fetchResponse.headers.get("content-type") || "";
  let bodySnippet = "";
  if (contentType.includes("application/json") || contentType.includes("text/")) {
    bodySnippet = await fetchResponse.clone().text().catch(() => "");
  }

  // Surface the hidden SSR error to PM2 logs so we can diagnose root cause.
  console.error(
    `[SSR ${fetchResponse.status}] ${request.method} ${url.pathname} :: ${bodySnippet.slice(0, 2000)}`,
  );

  await alerts.notify({
    kind: url.pathname.startsWith("/api/") ? "api" : "ssr",
    method: request.method,
    path: url.pathname,
    status: fetchResponse.status,
    bodySnippet,
  });
}

function serveNativeHealth(req, res) {
  const body = JSON.stringify({
    status: "ok",
    service: process.env.APP_NAME || "flowtixtools-web",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime?.() ?? 0),
    build: readDeployVersion(),
  });
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.end(req.method === "HEAD" ? undefined : body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(absoluteRequestUrl(req));
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/deploy-version.json") {
      const body = JSON.stringify(readDeployVersion());
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store, max-age=0");
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/public/health") {
      serveNativeHealth(req, res);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, url.pathname)) {
      return;
    }

    const isHead = req.method === "HEAD";
    const request = toFetchRequest(req, isHead ? "GET" : req.method);
    const handler = await getSsrHandler();
    const response = await handler.fetch(request, process.env, {});
    await alertOnServerError(response, request);
    await writeFetchResponse(response, res, { omitBody: isHead });
  } catch (error) {
    console.error(error);
    const pathname = (() => {
      try {
        return new URL(absoluteRequestUrl(req)).pathname;
      } catch {
        return req.url || "/";
      }
    })();
    await alerts.notify({
      kind: pathname.startsWith("/api/") ? "api-exception" : "ssr-exception",
      method: req.method,
      path: pathname,
      status: 500,
      error,
    });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", pathname.startsWith("/api/") ? "text/plain; charset=utf-8" : "text/html; charset=utf-8");
    }
    res.end(pathname.startsWith("/api/") ? "Internal Server Error" : renderSsrFallbackPage());
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Flowtix SSR server listening on http://127.0.0.1:${port}`);
});
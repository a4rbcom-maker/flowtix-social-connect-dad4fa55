import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import handler from "../dist/server/server.js";

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const clientRoot = resolve(root, "dist/client");

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

function toFetchRequest(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${port}`;
  const url = `${proto}://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeFetchResponse(fetchResponse, res) {
  res.statusCode = fetchResponse.status;
  res.statusMessage = fetchResponse.statusText;

  const setCookies = typeof fetchResponse.headers.getSetCookie === "function"
    ? fetchResponse.headers.getSetCookie()
    : [];

  fetchResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);

  if (!fetchResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(fetchResponse.body).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/deploy-version.json") {
      const sha = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || "development";
      const body = JSON.stringify({
        sha,
        short_sha: sha === "development" ? "dev" : sha.slice(0, 7),
        run_id: process.env.DEPLOY_RUN_ID || process.env.GITHUB_RUN_ID || null,
        repo: process.env.DEPLOY_REPOSITORY || process.env.GITHUB_REPOSITORY || null,
        deployed_at: process.env.DEPLOYED_AT || new Date().toISOString(),
        mode: "ssr",
        status: "ok",
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store, max-age=0");
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, url.pathname)) {
      return;
    }

    const request = toFetchRequest(req);
    const response = await handler.fetch(request, process.env, {});
    await writeFetchResponse(response, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Flowtix SSR server listening on http://127.0.0.1:${port}`);
});
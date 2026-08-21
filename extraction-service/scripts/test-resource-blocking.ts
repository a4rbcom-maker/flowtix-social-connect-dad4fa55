import { createServer, type ServerResponse } from "node:http";
import { chromium } from "playwright";
import { applyResourceBlocking } from "../src/services/context-manager.js";

const counters: Record<string, number> = {};
const bump = (key: string, res: ServerResponse) => {
  counters[key] = (counters[key] || 0) + 1;
};

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function pageHtml(): string {
  return `<!doctype html>
<html><head>
<link rel="stylesheet" href="/style.css">
<link rel="preload" href="/font.woff2" as="font">
<style>@font-face { font-family: x; src: url(/font.woff2); } body { font-family: x; }</style>
</head>
<body>
<img src="/photo1.png"><img src="/photo2.png"><img src="/photo3.png">
<video src="/clip.mp4"></video>
<div id="out">loading</div>
<script>
  fetch("/api/graphql/userlist").then(r => r.text()).then(t => {
    document.getElementById("out").textContent = "xhr:" + t;
  });
</script>
</body></html>`;
}

function startServer(): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    bump(path, res);
    if (path.startsWith("/api/")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, users: [1, 2, 3] }));
      return;
    }
    switch (path) {
      case "/style.css":
        res.setHeader("content-type", "text/css");
        res.end("body{color:red}");
        return;
      case "/font.woff2":
        res.setHeader("content-type", "font/woff2");
        res.end(Buffer.alloc(2048));
        return;
      case "/photo1.png":
      case "/photo2.png":
      case "/photo3.png":
        res.setHeader("content-type", "image/png");
        res.end(png1x1);
        return;
      case "/clip.mp4":
        res.setHeader("content-type", "video/mp4");
        res.end(Buffer.alloc(8192));
        return;
      default:
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(pageHtml());
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: typeof addr === "object" && addr ? addr.port : 0, close: () => server.close() });
    });
  });
}

async function runScenario(label: string, blocking: boolean): Promise<Record<string, number>> {
  for (const k of Object.keys(counters)) delete counters[k];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  if (blocking) await applyResourceBlocking(context);
  const page = await context.newPage();
  const { port } = serverInfo;
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  const out = await page.textContent("#out");
  await context.close();
  await browser.close();
  console.log(`\n[${label}] xhr result on page = ${out}`);
  return { ...counters };
}

let serverInfo: { port: number; close: () => void };

async function main(): Promise<void> {
  serverInfo = await startServer();

  const plain = await runScenario("WITHOUT blocking", false);
  const blocked = await runScenario("WITH blocking   ", true);

  serverInfo.close();

  const allKeys = Array.from(new Set([...Object.keys(plain), ...Object.keys(blocked)])).sort();
  console.log("\nrequest".padEnd(22), "no-block", "block");
  for (const k of allKeys) {
    console.log(k.padEnd(22), String(plain[k] || 0).padEnd(8), String(blocked[k] || 0));
  }

  const imgBlocked = (blocked["/photo1.png"] || 0) === 0 && (plain["/photo1.png"] || 0) > 0;
  const fontBlocked = (blocked["/font.woff2"] || 0) === 0 && (plain["/font.woff2"] || 0) > 0;
  const videoBlocked = (blocked["/clip.mp4"] || 0) === 0 && (plain["/clip.mp4"] || 0) > 0;
  const xhrAlive = (blocked["/api/graphql/userlist"] || 0) > 0;
  const cssAlive = (blocked["/style.css"] || 0) > 0;

  const checks = [
    { name: "images blocked", pass: imgBlocked },
    { name: "fonts blocked", pass: fontBlocked },
    { name: "video blocked", pass: videoBlocked },
    { name: "GraphQL/XHR still works", pass: xhrAlive },
    { name: "CSS still loads", pass: cssAlive },
  ];
  console.log("\n================ VERDICT ================");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  const allPass = checks.every((c) => c.pass);
  const saved = allKeys.filter(k => k.match(/\.(png|woff2|mp4)$/)).reduce((a, k) => a + ((plain[k] || 0) - (blocked[k] || 0)), 0);
  console.log(`\nheavy requests eliminated: ${saved}`);
  console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});

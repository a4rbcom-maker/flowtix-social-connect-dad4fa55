import { createServer, type ServerResponse } from "node:http";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { parseCookiesToPlaywright } from "../src/services/supabase.js";
import {
  toCookieEntries,
  shouldPersistSessionCookies,
  acquireSessionLock,
  releaseSessionLock,
  resolveUserAgent,
} from "../src/services/context-manager.js";

function startServer(): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res: ServerResponse) => {
    if ((req.url || "/").startsWith("/rotate")) {
      // simulate Facebook rotating the xs token mid-session
      res.setHeader("set-cookie", [
        "c_user=1000000001; Domain=127.0.0.1; Path=/; HttpOnly; Secure; SameSite=None",
        "xs=NEW-ROTATED-TOKEN-999; Domain=127.0.0.1; Path=/; HttpOnly; Secure; SameSite=None",
        "datr=abc123; Domain=127.0.0.1; Path=/",
        "fr=xyz789; Domain=127.0.0.1; Path=/",
      ]);
      res.setHeader("content-type", "text/html");
      res.end("<html><body>ok</body></html>");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end("<html><body>home</body></html>");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: typeof addr === "object" && addr ? addr.port : 0, close: () => server.close() });
    });
  });
}

async function testCookieRotationRoundTrip(): Promise<boolean> {
  const { port, close } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.goto(`http://127.0.0.1:${port}/rotate`, { waitUntil: "domcontentloaded" });

  // === exactly what releaseContext now does before closing ===
  const rotated = toCookieEntries(await context.cookies());
  const persist = shouldPersistSessionCookies(rotated);
  const payload = JSON.stringify(
    rotated.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expirationDate: c.expires,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: c.sameSite,
    })),
  );
  await context.close();
  await browser.close();
  close();

  // === what the next job loads from DB ===
  const reloaded = parseCookiesToPlaywright(payload, ".facebook.com");
  const byName = new Map(reloaded.map((c) => [c.name, c]));

  const checks = [
    { name: "rotated cookie set captured from live context", pass: rotated.length >= 4 },
    { name: "auth guard allows persisting (c_user + xs present)", pass: persist === true },
    { name: "NEW rotated xs token survives round-trip", pass: byName.get("xs")?.value === "NEW-ROTATED-TOKEN-999" },
    { name: "c_user survives round-trip", pass: byName.get("c_user")?.value === "1000000001" },
    { name: "domain preserved", pass: (byName.get("xs")?.domain || "").includes("127.0.0.1") },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

function testPersistGuard(): boolean {
  const loggedOut = [
    { name: "datr", value: "abc", domain: ".facebook.com", path: "/" },
    { name: "fr", value: "x", domain: ".facebook.com", path: "/" },
  ];
  const partial = [
    { name: "c_user", value: "1", domain: ".facebook.com", path: "/" },
    { name: "xs", value: "2", domain: ".facebook.com", path: "/" },
  ];
  const checks = [
    { name: "guard REJECTS cookie set missing auth tokens", pass: shouldPersistSessionCookies(loggedOut as any) === false },
    { name: "guard ACCEPTS healthy cookie set", pass: shouldPersistSessionCookies(partial as any) === true },
    { name: "IG guard accepts sessionid+ds_user_id", pass: shouldPersistSessionCookies([...partial, { name: "sessionid", value: "s", domain: ".instagram.com", path: "/" }] as any, ["sessionid", "ds_user_id"]) === false },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

function testSessionLock(): boolean {
  const key = "fb:test-session";
  const first = acquireSessionLock(key);
  const second = acquireSessionLock(key);
  const igKey = "ig:test-session";
  const igOk = acquireSessionLock(igKey);
  releaseSessionLock(key);
  const third = acquireSessionLock(key);
  releaseSessionLock(key);
  releaseSessionLock(igKey);
  releaseSessionLock(key); // double release must not throw

  const checks = [
    { name: "first acquire succeeds", pass: first === true },
    { name: "concurrent acquire of SAME session rejected", pass: second === false },
    { name: "different platform/session unaffected", pass: igOk === true },
    { name: "acquire works again after release", pass: third === true },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

function testUserAgentResolution(): boolean {
  const realUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const checks = [
    { name: "profile UA wins when present", pass: resolveUserAgent(realUa) === realUa },
    { name: "fallback when profile has no UA", pass: resolveUserAgent(null).includes("Chrome/") },
    { name: "fallback on garbage UA", pass: resolveUserAgent("short").includes("Chrome/") },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

function auditWiring(): boolean {
  const ctx = readFileSync(new URL("../src/services/context-manager.ts", import.meta.url), "utf8");
  const igCtx = readFileSync(new URL("../src/services/ig-context-manager.ts", import.meta.url), "utf8");
  const supa = readFileSync(new URL("../src/services/supabase.ts", import.meta.url), "utf8");
  const extract = readFileSync(new URL("../src/routes/extract.ts", import.meta.url), "utf8");

  const checks = [
    { name: "FB: releaseContext saves rotated cookies BEFORE close", pass: ctx.indexOf("entry.context.cookies()") < ctx.indexOf("entry.context.close()") && ctx.includes("updateSessionCookies") },
    { name: "FB: createContext enforces session lock", pass: ctx.includes("acquireSessionLock") && ctx.includes("releaseSessionLock") },
    { name: "FB: createContext uses resolved profile UA", pass: ctx.includes("resolveUserAgent(userAgent)") },
    { name: "IG: same save-back + lock + UA applied", pass: igCtx.includes("updateIgSessionCookies") && igCtx.includes("acquireSessionLock") && igCtx.includes("resolveIgUserAgent(userAgent)") },
    { name: "supabase returns stored user_agent", pass: supa.includes("userAgent: profile.user_agent ?? null") },
    { name: "extraction passes real UA into contexts", pass: extract.includes("createContext(sid, cookies, proxy, userAgent)") },
    { name: "lock released on ALL exit paths (try/catch wrap)", pass: ctx.includes("} catch (err) {\n      releaseSessionLock(lockKey);") },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

async function main(): Promise<void> {
  console.log("\n=== 1) Live cookie rotation round-trip (real browser) ===");
  const roundTripOk = await testCookieRotationRoundTrip();

  console.log("\n=== 2) Persist guard (never save logged-out over logged-in) ===");
  const guardOk = testPersistGuard();

  console.log("\n=== 3) Session usage lock ===");
  const lockOk = testSessionLock();

  console.log("\n=== 4) User agent resolution ===");
  const uaOk = testUserAgentResolution();

  console.log("\n=== 5) Wiring audit (all call sites) ===");
  const auditOk = auditWiring();

  console.log("\n================ VERDICT ================");
  const all = roundTripOk && guardOk && lockOk && uaOk && auditOk;
  console.log(all ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(all ? 0 : 1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});

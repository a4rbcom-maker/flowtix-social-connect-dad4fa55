import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { multiSessionGroupMembers, type GroupMemberUser } from "../src/services/group-members-core.js";

const TOTAL = 500;
const BATCH = 40;
const MAX_BATCHES_PER_SESSION = 5;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const userName = (uid: number) => `عضو ${String(uid).padStart(4, "0")}`;
const userId = (uid: number) => String(1000000000000000 + uid);

let sidCounter = 0;
const sessionSeeds = new Map<string, number>();
const sessionFetches = new Map<string, number>();

function pageHtml(): string {
  const sidebarLinks = Array.from({ length: 15 }, (_, i) => {
    const uid = i + 1;
    return `<a href="/groups/12345/user/${userId(uid)}">${userName(uid)}</a><br/>`;
  }).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>الأعضاء | فيسبوك</title>
<style>#sidebar a, #list a { display:block; padding:8px 6px; }</style></head>
<body>
<div role="navigation" data-pagelet="nav"><span>Group Test · 500 members · أعضاء</span></div>
<div style="display:flex;gap:8px;padding:8px">
  <div id="sidebar" style="overflow-y:auto;height:240px;width:220px;border:1px solid #ccc">${sidebarLinks}</div>
  <div id="main" style="overflow-y:auto;height:400px;flex:1;border:1px solid #ccc"><div id="list"></div></div>
</div>
<script>
  const TOTAL = ${TOTAL};
  const params = new URLSearchParams(location.search);
  let seed = parseInt(params.get("seed") || "0", 10);
  let cursor = 0, inflight = false, lastFetch = 0;
  const list = document.getElementById("list");
  const uidAt = (i) => ((i + seed) % TOTAL) + 1;
  function anchor(u) {
    const a = document.createElement("a");
    a.href = "/groups/12345/user/" + String(1000000000000000 + u);
    a.textContent = "عضو " + String(u).padStart(4, "0");
    return a;
  }
  for (let j = 0; j < 15 && j < TOTAL; j++) list.appendChild(anchor(uidAt(j)));
  async function loadMore() {
    if (inflight || cursor >= TOTAL) return;
    if (Date.now() - lastFetch < 300) return;
    inflight = true; lastFetch = Date.now();
    try {
      const res = await fetch("/api/graphql/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cursor, seed }),
      });
      let text = await res.text();
      if (text.startsWith("for (;;);")) text = text.substring(9);
      const conn = JSON.parse(text).data.group.new_members;
      for (const e of conn.edges) {
        const a = document.createElement("a");
        a.href = "/groups/12345/user/" + e.node.id;
        a.textContent = e.node.name;
        list.appendChild(a);
      }
      while (list.children.length > 60) list.removeChild(list.firstChild);
      cursor = parseInt(conn.page_info.end_cursor, 10);
      if (!conn.page_info.has_next_page) cursor = TOTAL;
    } finally { inflight = false; }
  }
  document.getElementById("main").addEventListener("scroll", () => {
    const el = document.getElementById("main");
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadMore();
  });
</script>
</body></html>`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function startServer(): Promise<{ port: number; close: () => void }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    const cookies = (req.headers.cookie || "").split(";").map((c) => c.trim());
    const sidCookie = cookies.find((c) => c.startsWith("sid="));
    let sid = sidCookie ? sidCookie.substring(4) : `s${sidCounter++}`;
    if (!sidCookie) {
      const seed = (parseInt(sid.substring(1), 10) * 167) % TOTAL;
      sessionSeeds.set(sid, seed);
      res.setHeader("set-cookie", `sid=${sid}; Path=/`);
    }

    if (url.pathname === "/api/graphql/" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { cursor?: number; seed?: number };
      const cursor = typeof body.cursor === "number" ? body.cursor : 0;
      const seed = sessionSeeds.get(sid) ?? 0;
      const fetches = sessionFetches.get(sid) ?? 0;

      let edges: Array<{ node: { id: string; name: string; url: string } }> = [];
      let endCursor = cursor;
      let hasNext = cursor < TOTAL;

      if (fetches < MAX_BATCHES_PER_SESSION && cursor < TOTAL) {
        edges = [];
        for (let j = 0; j < BATCH && cursor + j < TOTAL; j++) {
          const uid = ((cursor + j + seed) % TOTAL) + 1;
          edges.push({ node: { id: userId(uid), name: userName(uid), url: `/groups/12345/user/${userId(uid)}/` } });
        }
        endCursor = Math.min(cursor + BATCH, TOTAL);
        hasNext = endCursor < TOTAL;
      }
      sessionFetches.set(sid, fetches + 1);

      res.setHeader("content-type", "text/plain");
      res.end(
        "for (;;);" +
          JSON.stringify({
            data: { group: { new_members: { edges, page_info: { end_cursor: String(endCursor), has_next_page: hasNext } } } },
          }),
      );
      return;
    }

    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(pageHtml());
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

async function oldScrollFeed(page: Page): Promise<void> {
  const target = await page.evaluate(() => {
    const sel = 'a[href*="profile.php?id="], a[href*="/user/"], a[href*="/groups/"][href*="/user/"], a[href*="facebook.com/"]';
    for (const el of Array.from(document.querySelectorAll("div"))) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.querySelectorAll(sel).length < 2) continue;
      const style = window.getComputedStyle(htmlEl);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && htmlEl.scrollHeight > htmlEl.clientHeight + 20) {
        const rect = htmlEl.getBoundingClientRect();
        if (rect.height > 150 && rect.width > 150) {
          htmlEl.scrollTop += Math.min(htmlEl.clientHeight * 0.7, 600);
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
        }
      }
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2, found: false };
  });
  await page.mouse.move(target.x, target.y);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(800);
}

async function simulateOldExtractor(page: Page, membersUrl: string): Promise<number> {
  await page.goto(membersUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const seen = new Set<string>();
  let total = 0;
  let consecutiveEmpty = 0;
  let scrollAttempts = 0;

  while (scrollAttempts < 60) {
    const rawLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((l) => ({
        href: l.getAttribute("href") || "",
        text: ((l as HTMLElement).innerText || "").trim(),
      })),
    );
    let newCount = 0;
    for (const l of rawLinks) {
      const m = l.href.match(/\/groups\/\d+\/user\/(\d+)\b/) || l.href.match(/profile\.php\?id=(\d+)/) || l.href.match(/\/user\/(\d+)\b/);
      if (!m || !l.text || l.text.length < 3) continue;
      if (/^\d+$/.test(m[1]) && (m[1].length < 5 || m[1].length > 16)) continue;
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        newCount++;
      }
    }
    if (newCount > 0) {
      total += newCount;
      consecutiveEmpty = 0;
    } else {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 12) break;
    }
    scrollAttempts++;
    await oldScrollFeed(page);
    await sleep(600);
  }
  return total;
}

async function main(): Promise<void> {
  const { port, close } = await startServer();
  const membersUrl = `http://127.0.0.1:${port}/groups/12345/members`;
  const browser = await chromium.launch({ headless: true });

  console.log(`\n[Harness] mock group: ${TOTAL} members, ${BATCH}/batch, soft rate-limit = ${MAX_BATCHES_PER_SESSION} batches/session`);
  console.log(`[Harness] membersUrl = ${membersUrl}\n`);

  const ctxOld = await browser.newContext();
  const pageOld = await ctxOld.newPage();
  const oldTotal = await simulateOldExtractor(pageOld, membersUrl);
  await ctxOld.close();
  console.log(`[BEFORE] old extractor (DOM-only, first-container scroll, 12-empty stop): ${oldTotal}/${TOTAL} (${((oldTotal / TOTAL) * 100).toFixed(1)}%)`);

  const runNew = async (label: string, sessionCount: number) => {
    const shared: GroupMemberUser[] = [];
    const seen = new Set<string>();
    let flushes = 0;
    let flushedTotal = 0;
    const contexts = [];
    const pages = [];
    for (let i = 0; i < sessionCount; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const p = await ctx.newPage();
      pages.push({ sessionId: `session-${i + 1}`, page: p });
    }
    const result = await multiSessionGroupMembers(pages, membersUrl, shared, seen, {
      targetCount: TOTAL,
      maxDurationMs: 90_000,
      scrollDelayMs: 250,
      maxIdleRounds: 8,
      maxWakeUpAttempts: 2,
      onNewUsers: (users) => {
        flushes++;
        flushedTotal += users.length;
      },
    });
    const uniqueIds = new Set(shared.map((u) => u.fb_id));
    for (const ctx of contexts) await ctx.close();
    console.log(`[AFTER ] ${label}: ${shared.length}/${TOTAL} (${((shared.length / TOTAL) * 100).toFixed(1)}%) | unique=${uniqueIds.size} | incremental flushes=${flushes} (sum=${flushedTotal}) | reason=${result.stoppedReason}`);
    for (const s of result.perSession) {
      console.log(`          session ${s.sessionId}: ${s.extracted} users (${s.rounds} rounds, ${s.stoppedReason})`);
    }
    return { shared: shared.length, unique: uniqueIds.size, result, flushes };
  };

  const single = await runNew("new core, 1 session ", 1);
  const triple = await runNew("new core, 3 sessions", 3);

  await browser.close();
  close();

  console.log("\n================ VERDICT ================");
  const oldPct = (oldTotal / TOTAL) * 100;
  const singlePct = (single.shared / TOTAL) * 100;
  const triplePct = (triple.shared / TOTAL) * 100;

  const checks = [
    { name: "bug reproduced (old = 15)", pass: oldTotal === 15 },
    { name: "single session improves but capped (old < single < TOTAL)", pass: oldTotal < single.shared && single.shared < TOTAL },
    { name: "3 sessions >= 70% coverage", pass: triplePct >= 70 },
    { name: "sessions multiply coverage (triple > single)", pass: triple.shared > single.shared },
    { name: "no duplicates in final list (dedup)", pass: triple.unique === triple.shared },
    { name: "incremental save (multiple flushes)", pass: triple.flushes >= 3 },
  ];
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  const allPass = checks.every((c) => c.pass);
  console.log(`\nold=${oldTotal} (${oldPct.toFixed(0)}%)  single=${single.shared} (${singlePct.toFixed(0)}%)  triple=${triple.shared} (${triplePct.toFixed(0)}%)`);
  console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});

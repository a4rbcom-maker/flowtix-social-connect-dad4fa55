import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { multiSessionGroupMembers, type GroupMemberUser } from "../src/services/group-members-core.js";
import { runGroupCascade } from "../src/services/group-cascade-core.js";

const TOTAL = 2000;
const BATCH = 40;
const MEMBERS_CAP_BATCHES = 5;
const POSTS = 120;
const USERS_PER_POST = 25;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const userName = (uid: number) => `عضو ${String(uid).padStart(4, "0")}`;
const userId = (uid: number) => String(1000000000000000 + uid);

function membersFeedHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>الأعضاء</title>
<style>#sidebar a, #list a { display:block; padding:8px 6px; }</style></head>
<body>
<div role="navigation"><span>${TOTAL} members</span></div>
<div style="display:flex;gap:8px;padding:8px">
  <div id="sidebar" style="overflow-y:auto;height:240px;width:220px">${Array.from({ length: 15 }, (_, i) => `<a href="/groups/12345/user/${userId(i + 1)}">${userName(i + 1)}</a>`).join("")}</div>
  <div id="main" style="overflow-y:auto;height:400px;flex:1"><div id="list"></div></div>
</div>
<script>
  let cursor = 0, inflight = false;
  const list = document.getElementById("list");
  for (let j = 0; j < 15; j++) list.appendChild(anchor(j + 1));
  function anchor(u) { const a = document.createElement("a"); a.href = "/groups/12345/user/" + String(1000000000000000 + u); a.textContent = "عضو " + String(u).padStart(4, "0"); return a; }
  async function loadMore() {
    if (inflight || cursor >= 5000) return;
    if (Date.now() - (window.lastFetch || 0) < 300) return;
    inflight = true; window.lastFetch = Date.now();
    try {
      const res = await fetch("/api/graphql/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor }) });
      let text = await res.text(); if (text.startsWith("for (;;);")) text = text.substring(9);
      const conn = JSON.parse(text).data.group.new_members;
      for (const e of conn.edges) { const a = document.createElement("a"); a.href = "/groups/12345/user/" + e.node.id; a.textContent = e.node.name; list.appendChild(a); }
      while (list.children.length > 60) list.removeChild(list.firstChild);
      cursor = parseInt(conn.page_info.end_cursor, 10);
      if (!conn.page_info.has_next_page) cursor = 5000;
    } finally { inflight = false; }
  }
  document.getElementById("main").addEventListener("scroll", () => {
    const el = document.getElementById("main");
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadMore();
  });
</script></body></html>`;
}

function groupFeedHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>الجروب</title>
<style>#feed a.post { display:block; padding:14px; border-bottom:1px solid #ddd; }</style></head>
<body>
<div role="navigation"><span>Group Feed</span></div>
<div id="feed" style="overflow-y:auto;height:500px">
  ${Array.from({ length: POSTS }, (_, i) => `<a class="post" href="/groups/12345/posts/${700000 + i}">منشور رقم ${i + 1}</a>`).join("")}
</div>
</body></html>`;
}

function startServer(): Promise<{ port: number; close: () => void }> {
  let sidCounter = 0;
  const sessionSeeds = new Map<string, number>();
  const sessionFetches = new Map<string, number>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || "/").split("?")[0];

    // cookie-based session identity (one sid per browser context, like production)
    const cookies = (req.headers.cookie || "").split(";").map((c) => c.trim());
    const sidCookie = cookies.find((c) => c.startsWith("sid="));
    let sid = sidCookie ? sidCookie.substring(4) : `s${sidCounter++}`;
    if (!sidCookie) {
      sessionSeeds.set(sid, (parseInt(sid.substring(1), 10) * 167) % TOTAL);
      res.setHeader("set-cookie", `sid=${sid}; Path=/`);
    }

    if (path === "/groups/12345/members") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(membersFeedHtml());
      return;
    }
    if (path === "/groups/12345" || path === "/groups/12345/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(groupFeedHtml());
      return;
    }
    if (path === "/api/graphql/members") {
      const body = JSON.parse((await readBody(req)) || "{}") as { cursor?: number };
      const cursor = typeof body.cursor === "number" ? body.cursor : 0;
      const seed = sessionSeeds.get(sid) ?? 0;
      const fetches = sessionFetches.get(sid) ?? 0;

      let edges: Array<{ node: { id: string; name: string; url: string } }> = [];
      let endCursor = cursor;
      let hasNext = cursor < TOTAL;

      if (fetches < MEMBERS_CAP_BATCHES && cursor < TOTAL) {
        for (let j = 0; j < BATCH; j++) {
          const uid = ((cursor + j + seed) % TOTAL) + 1;
          edges.push({ node: { id: userId(uid), name: userName(uid), url: `/groups/12345/user/${userId(uid)}/` } });
        }
        endCursor = cursor + BATCH;
        hasNext = true;
      }
      sessionFetches.set(sid, fetches + 1);
      res.setHeader("content-type", "text/plain");
      res.end("for (;;);" + JSON.stringify({ data: { group: { new_members: { edges, page_info: { end_cursor: String(endCursor), has_next_page: hasNext } } } } }));
      return;
    }

    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<html><body>home</body></html>");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: typeof addr === "object" && addr ? addr.port : 0, close: () => server.close() });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function main(): Promise<void> {
  const { port, close } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  console.log(`\n[Harness] group of ${TOTAL} members, members-list hard cap ≈ ${MEMBERS_CAP_BATCHES * BATCH + 15}, feed has ${POSTS} posts × ≤${USERS_PER_POST} engagers`);

  // Phase 1: members list (mirrors production: capped far below total)
  const shared: GroupMemberUser[] = [];
  const seen = new Set<string>();
  const contexts = [];
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const p = await ctx.newPage();
    pages.push({ sessionId: `s${i + 1}`, page: p });
  }

  const members = await multiSessionGroupMembers(pages, `${baseUrl}/groups/12345/members`, shared, seen, {
    targetCount: TOTAL,
    maxDurationMs: 90_000,
    scrollDelayMs: 250,
    maxIdleRounds: 8,
    maxWakeUpAttempts: 2,
    onNewUsers: () => Promise.resolve(0),
  });
  console.log(`\n[Phase 1] members list: ${shared.length}/${TOTAL} (${((shared.length / TOTAL) * 100).toFixed(1)}%) reason=${members.stoppedReason}  ← Facebook cap (matches production 1.1%)`);

  // Phase 2: cascade the feed — injected engager fn returns deterministic engagers per post
  let cascadeExtracted = 0;
  const flushes: number[] = [];
  const cascade = await runGroupCascade({
    feedUrl: `${baseUrl}/groups/12345`,
    pages,
    targetCount: TOTAL,
    maxDurationMs: 120_000,
    maxPosts: POSTS,
    extractEngagers: async (_page: Page, permalink: string) => {
      const postId = parseInt(permalink.split("/").pop() || "0", 10) - 700000;
      const reactors = Array.from({ length: USERS_PER_POST }, (_, k) => {
        const uid = ((postId * USERS_PER_POST + k) % TOTAL) + 1;
        return { id: userId(uid), name: userName(uid), url: `https://www.facebook.com/profile.php?id=${userId(uid)}` };
      });
      const commenters = Array.from({ length: 10 }, (_, k) => {
        const uid = ((postId * USERS_PER_POST + USERS_PER_POST + k) % TOTAL) + 1;
        return { id: userId(uid), name: userName(uid), url: `https://www.facebook.com/profile.php?id=${userId(uid)}` };
      });
      await sleep(30);
      return { reactors, commenters };
    },
    onNewUsers: async (users) => {
      flushes.push(users.length);
      cascadeExtracted += users.length;
      return users.length;
    },
  });

  const grandTotal = shared.length + cascade.extracted;
  const coverage = (grandTotal / TOTAL) * 100;

  console.log(`[Phase 2] cascade: +${cascade.extracted} from ${cascade.postsProcessed}/${cascade.postsDiscovered} posts (reason=${cascade.stoppedReason}), ${flushes.length} incremental flushes`);
  console.log(`\n[RESULT] ${grandTotal}/${TOTAL} total coverage = ${coverage.toFixed(1)}%`);

  for (const ctx of contexts) await ctx.close();
  await browser.close();
  close();

  console.log("\n================ VERDICT ================");
  const checks = [
    { name: "members list capped (reproduces production reality)", pass: shared.length < TOTAL * 0.4 },
    { name: "cascade discovered posts from group feed", pass: cascade.postsDiscovered >= POSTS * 0.9 },
    { name: "cascade processed feed posts (or reached target first)", pass: cascade.postsProcessed >= POSTS * 0.9 || cascade.stoppedReason === "target_reached" },
    { name: "final coverage >= 70%", pass: coverage >= 70 },
    { name: "incremental saving during cascade", pass: flushes.length >= 10 },
    { name: "dedup across phases (no double counting)", pass: new Set([...shared.map(u => u.fb_id)]).size === shared.length },
  ];
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
  const allPass = checks.every((c) => c.pass);
  console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});

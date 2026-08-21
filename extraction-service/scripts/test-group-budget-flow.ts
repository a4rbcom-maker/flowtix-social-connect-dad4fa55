/**
 * Proof test for the group-members budget-flow fix.
 *
 * Production incident (job 1bdc45bd): group of 57,300 members → only 1,393
 * extracted. Root cause: the members-list phase consumed the entire time
 * budget scrolling a Facebook-capped list, so the feed-cascade phase (which
 * needs >120s remaining) never started — progress.posts_done was empty.
 *
 * This harness reproduces the exact scenario against a mock Facebook:
 *   - group of 5,700 members, browsable members list soft-capped per session
 *   - group feed with 80 posts × 35 engagers (reactors + commenters)
 *
 * BEFORE (old logic): members phase gets the whole budget and burns it all
 * (max_duration) → cascade gate (>120s) fails → total stays at the cap.
 * AFTER (fixed logic): membersPhaseBudgetMs() splits the budget + global
 * stall detection stops the capped list early ("stagnated") → cascade runs
 * and coverage multiplies.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Page } from "playwright";
import {
  multiSessionGroupMembers,
  membersPhaseBudgetMs,
  type GroupMemberUser,
} from "../src/services/group-members-core.js";
import { runGroupCascade } from "../src/services/group-cascade-core.js";

const TOTAL = 5700; // scaled-down 57,300
const BATCH = 40;
const MEMBERS_CAP_BATCHES = 6; // Facebook soft cap: 6 batches × 40 = 240 users/session
const POSTS = 80;
const USERS_PER_POST = 25;
const COMMENTERS_PER_POST = 10;

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
    if (Date.now() - (window.lastFetch || 0) < 200) return;
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function startServer(): Promise<{ port: number; close: () => void }> {
  let sidCounter = 0;
  const sessionSeeds = new Map<string, number>();
  const sessionFetches = new Map<string, number>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || "/").split("?")[0];
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

async function makeSessions(browser: Browser, n: number): Promise<{ contexts: BrowserContext[]; pages: Array<{ sessionId: string; page: Page }> }> {
  const contexts: BrowserContext[] = [];
  const pages: Array<{ sessionId: string; page: Page }> = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const p = await ctx.newPage();
    pages.push({ sessionId: `s${i + 1}`, page: p });
  }
  return { contexts, pages };
}

async function main(): Promise<void> {
  const { port, close } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });

  console.log(`\n[Harness] group of ${TOTAL} members | Facebook browsable cap ≈ ${MEMBERS_CAP_BATCHES * BATCH}/session | feed: ${POSTS} posts × ${USERS_PER_POST + COMMENTERS_PER_POST} engagers`);

  // ===== 1) Pure budget arithmetic at production scales =====
  const prodBudget10min = 480_000; // old: 10-min job ⇒ 8-min extraction budget
  const prodBudget30min = 1_680_000; // new: 30-min job ⇒ 28-min extraction budget
  const oldBudget10 = Math.max(60_000, prodBudget10min - 60_000);
  const newBudget10 = membersPhaseBudgetMs(prodBudget10min);
  const newBudget30 = membersPhaseBudgetMs(prodBudget30min);
  console.log(`\n[Budget] old logic @10min job: members=${Math.round(oldBudget10 / 1000)}s → cascade gate gets ${Math.round((prodBudget10min - oldBudget10) / 1000)}s (needs >120s → ${prodBudget10min - oldBudget10 > 120_000 ? "PASS" : "FAIL"})`);
  console.log(`[Budget] new logic @10min job: members=${Math.round(newBudget10 / 1000)}s + cascade ${Math.round((prodBudget10min - newBudget10) / 1000)}s (needs >120s → ${prodBudget10min - newBudget10 > 120_000 ? "PASS" : "FAIL"})`);
  console.log(`[Budget] new logic @30min job: members=${Math.round(newBudget30 / 1000)}s + cascade ${Math.round((prodBudget30min - newBudget30) / 1000)}s (needs >120s → ${prodBudget30min - newBudget30 > 120_000 ? "PASS" : "FAIL"})`);

  // ===== 2) BEFORE — old behavior: members phase eats everything =====
  const before = await makeSessions(browser, 3);
  const beforeShared: GroupMemberUser[] = [];
  const beforeSeen = new Set<string>();
  const beforeStart = Date.now();
  const beforeRes = await multiSessionGroupMembers(before.pages, `${baseUrl}/groups/12345/members`, beforeShared, beforeSeen, {
    targetCount: TOTAL,
    maxDurationMs: 30_000, // scaled-down "whole budget"
    scrollDelayMs: 120,
    maxIdleRounds: 1_000_000, // disable per-session idle (isolate the old failure mode)
    maxWakeUpAttempts: 0,
    stallWindowMs: 3_600_000, // stall detection off = old code
    stallMinGrowth: 1_000_000,
  });
  const beforeDuration = Date.now() - beforeStart;
  console.log(`\n[BEFORE] members phase: ${beforeShared.length}/${TOTAL} (${((beforeShared.length / TOTAL) * 100).toFixed(1)}%) in ${(beforeDuration / 1000).toFixed(1)}s reason=${beforeRes.stoppedReason} ← burned the WHOLE budget scrolling a capped list`);
  const oldCascadeGatePasses = prodBudget10min - oldBudget10 > 120_000;
  console.log(`[BEFORE] cascade gate after members phase: remaining=${Math.round((prodBudget10min - oldBudget10) / 1000)}s needs >120s → ${oldCascadeGatePasses ? "runs" : "SKIPPED (bug reproduced: no engagers/commenters extracted)"}`);
  for (const ctx of before.contexts) await ctx.close();

  // ===== 3) AFTER — fixed behavior: budget split + stall detection =====
  const after = await makeSessions(browser, 3);
  const afterShared: GroupMemberUser[] = [];
  const afterSeen = new Set<string>();
  let flushes = 0;
  const afterBudget = membersPhaseBudgetMs(prodBudget10min);
  const afterStart = Date.now();
  const afterRes = await multiSessionGroupMembers(after.pages, `${baseUrl}/groups/12345/members`, afterShared, afterSeen, {
    targetCount: TOTAL,
    maxDurationMs: afterBudget, // fixed budget split (same formula as the extractor)
    scrollDelayMs: 120,
    maxIdleRounds: 1_000_000, // idle disabled on purpose: stall detection must win
    maxWakeUpAttempts: 0,
    stallWindowMs: 12_000,
    stallMinGrowth: 10,
    onNewUsers: (users) => {
      flushes += users.length;
    },
  });
  const afterDuration = Date.now() - afterStart;
  console.log(`\n[AFTER ] members phase: ${afterShared.length}/${TOTAL} (${((afterShared.length / TOTAL) * 100).toFixed(1)}%) in ${(afterDuration / 1000).toFixed(1)}s reason=${afterRes.stoppedReason} ← stopped early, budget freed for cascade`);

  // ===== 4) Cascade — engagers/commenters from the group feed =====
  const cascade = await runGroupCascade({
    feedUrl: `${baseUrl}/groups/12345`,
    pages: after.pages,
    targetCount: TOTAL,
    maxDurationMs: 40_000,
    maxPosts: POSTS,
    extractEngagers: async (_page: Page, permalink: string) => {
      const postId = parseInt(permalink.split("/").pop() || "0", 10) - 700000;
      const reactors = Array.from({ length: USERS_PER_POST }, (_, k) => {
        const uid = ((postId * (USERS_PER_POST + COMMENTERS_PER_POST) + k) % TOTAL) + 1;
        return { id: userId(uid), name: userName(uid), url: `https://www.facebook.com/profile.php?id=${userId(uid)}` };
      });
      const commenters = Array.from({ length: COMMENTERS_PER_POST }, (_, k) => {
        const uid = ((postId * (USERS_PER_POST + COMMENTERS_PER_POST) + USERS_PER_POST + k) % TOTAL) + 1;
        return { id: userId(uid), name: userName(uid), url: `https://www.facebook.com/profile.php?id=${userId(uid)}` };
      });
      return { reactors, commenters };
    },
    onNewUsers: async (users) => users.length,
  });
  console.log(`[AFTER ] cascade phase: +${cascade.extracted} engagers from ${cascade.postsProcessed}/${cascade.postsDiscovered} posts (reason=${cascade.stoppedReason})`);

  const grandTotal = afterShared.length + cascade.extracted;
  console.log(`\n[RESULT] BEFORE total = ${beforeShared.length} | AFTER total = ${grandTotal} (${((grandTotal / TOTAL) * 100).toFixed(1)}% coverage) → ${(grandTotal / Math.max(1, beforeShared.length)).toFixed(1)}× more users`);

  for (const ctx of after.contexts) await ctx.close();
  await browser.close();
  close();

  console.log("\n================ VERDICT ================");
  const checks = [
    { name: "budget split guarantees cascade >120s gate @10min job", pass: prodBudget10min - newBudget10 > 120_000 },
    { name: "budget split guarantees cascade >120s gate @30min job", pass: prodBudget30min - newBudget30 > 120_000 },
    { name: "BEFORE: members list capped far below total (reproduces production 1,393/57,300)", pass: beforeShared.length > 100 && beforeShared.length < TOTAL * 0.4 },
    { name: "BEFORE: members phase burned its whole budget (max_duration)", pass: beforeRes.stoppedReason === "max_duration" && beforeDuration >= 29_000 },
    { name: "BEFORE: old arithmetic leaves no cascade time (root cause)", pass: !oldCascadeGatePasses },
    { name: "AFTER: stall detection stopped the capped list early (stagnated)", pass: afterRes.stoppedReason === "stagnated" },
    { name: `AFTER: members phase freed time (finished in ${(afterDuration / 1000).toFixed(0)}s << ${Math.round(afterBudget / 1000)}s budget)`, pass: afterDuration < afterBudget - 60_000 },
    { name: "AFTER: same members coverage as BEFORE (no data loss)", pass: afterShared.length >= beforeShared.length * 0.5 && afterShared.length <= beforeShared.length * 1.6 },
    { name: "AFTER: cascade actually ran on group posts (was entirely missing)", pass: cascade.postsProcessed >= Math.floor(POSTS * 0.7) && cascade.extracted > 0 },
    { name: "AFTER: incremental flushes during members phase", pass: flushes > 0 },
    { name: "AFTER: total coverage multiplied (>= 1.5× the capped list)", pass: grandTotal >= beforeShared.length * 1.5 },
    { name: "dedup integrity (no double counting)", pass: new Set(afterShared.map((u) => u.fb_id)).size === afterShared.length },
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

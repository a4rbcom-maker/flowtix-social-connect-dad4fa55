/**
 * LIVE PROBE: Capture ALL GraphQL requests FB fires when opening a post,
 * clicking "more comments", and opening the reactions dialog.
 *
 * Run: npx tsx src/debug-fb-graphql-capture.ts
 */
import { chromium } from "playwright";
import fs from "fs";

const sessionRaw = JSON.parse(fs.readFileSync("probe-session.json", "utf8"));
const COOKIES = (sessionRaw.cookies_enc ? JSON.parse(sessionRaw.cookies_enc) : []).filter((c: any) => c.domain?.includes("facebook") || c.name === "c_user" || c.name === "xs" || c.name === "datr");

const POST = process.env.POST_URL || "https://www.facebook.com/photo/?fbid=1221636096527884854&set=a.122111574212624039";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  await ctx.addCookies(COOKIES.map((c: any) => ({
    name: c.name, value: c.value,
    domain: c.domain || ".facebook.com",
    path: c.path || "/",
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? true,
    sameSite: c.sameSite || "Lax",
  })));
  const page = await ctx.newPage();

  // -------------------------------------------------------
  // Phase 1: Post page load — capture everything from the start
  // -------------------------------------------------------
  const allRequests: any[] = [];
  const allResponses: Map<string, string> = new Map();
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/api/graphql/") && !url.includes("/graphql/")) return;
    if (req.method() !== "POST") return;
    try {
      const pd = req.postData();
      if (!pd) return;
      const parsed = new URLSearchParams(pd);
      allRequests.push({
        url: url.substring(0, 120),
        doc_id: parsed.get("doc_id"),
        variables: parsed.get("variables") ? JSON.parse(parsed.get("variables")!) : null,
        fb_dtsg: parsed.get("fb_dtsg")?.substring(0, 10),
      });
    } catch {}
  });
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/api/graphql/") && !url.includes("/graphql/")) return;
    if (resp.status() !== 200) return;
    try {
      const text = await resp.text();
      allResponses.set(url + "#" + allRequests.length, text);
    } catch {}
  });

  console.log(`\n=== Phase 1: Loading post ===\n${POST}`);
  await page.goto(POST, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log(`  Requests captured during load: ${allRequests.length}`);

  // Print all captured requests before any interaction
  console.log("\n=== CAPTURED REQUESTS (initial load) ===");
  for (let i = 0; i < allRequests.length; i++) {
    const r = allRequests[i];
    console.log(`\n  [${i}] doc_id=${r.doc_id}`);
    console.log(`      url=${r.url.substring(0, 100)}`);
    if (r.variables) {
      const keys = Object.keys(r.variables).join(", ");
      const hasCursor = JSON.stringify(r.variables).includes("cursor") || JSON.stringify(r.variables).includes("after") || JSON.stringify(r.variables).includes("end_cursor");
      const hasFeedback = JSON.stringify(r.variables).includes("feedback") || JSON.stringify(r.variables).includes("comment") || JSON.stringify(r.variables).includes("reaction");
      console.log(`      variables keys: ${keys}`);
      if (hasCursor) console.log(`      ⭐ HAS CURSOR — pagination candidate!`);
      if (hasFeedback) console.log(`      ⭐ HAS feedback/comment/reaction!`);
    }
  }

  // Check responses for user links and page_info
  console.log("\n=== RESPONSE ANALYSIS ===");
  let respIdx = 0;
  for (const [rKey, rBody] of allResponses) {
    const hasUsers = /profile\.php\?id=\d{5,25}/.test(rBody);
    const hasPageInfo = /"has_next_page"\s*:\s*true/.test(rBody) || /"end_cursor"/.test(rBody);
    const hasEdges = /"edges"\s*:/.test(rBody);
    const size = rBody.length;
    if (hasUsers || hasPageInfo || hasEdges) {
      console.log(`\n  [resp #${respIdx}] size=${size}`);
      if (hasUsers) console.log(`      ⭐ HAS user links (profile.php?id=)`);
      if (hasPageInfo) console.log(`      ⭐ HAS page_info pagination!`);
      if (hasEdges) {
        // count edges
        const edgeMatch = rBody.match(/"edges"\s*:\s*\[([\s\S]*?)\]/g);
        console.log(`      ⭐ HAS edges array (${edgeMatch?.length ?? "?"} matches)`);
      }
    }
    respIdx++;
  }

  // -------------------------------------------------------
  // Phase 2: Try "view more comments" / expand thread
  // -------------------------------------------------------
  console.log(`\n=== Phase 2: Clicking "more comments" ===`);
  const beforeComments = allRequests.length;
  const clicked = await page.evaluate(() => {
    const keywords = ["view more comments", "عرض المزيد من التعليقات", "more comments",
      "عرض كل التعليقات", "all comments", "view all comments", "see all"];
    const all = document.querySelectorAll<HTMLElement>('[role="button"], a, span, div');
    for (const el of all) {
      const t = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (!t || t.length > 80) continue;
      for (const kw of keywords) { if (t.includes(kw)) { el.click(); return kw; } }
    }
    return null;
  });
  console.log(`  Clicked: ${clicked}`);
  await page.waitForTimeout(4000);
  console.log(`  New GraphQL requests: ${allRequests.length - beforeComments}`);

  // -------------------------------------------------------
  // Phase 3: Open reactions dialog
  // -------------------------------------------------------
  console.log(`\n=== Phase 3: Opening reactions dialog ===`);
  const beforeReactions = allRequests.length;
  const dialogClicked = await page.evaluate(() => {
    // Try reaction link first
    const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/ufi/reaction/"]');
    if (links.length > 0) { links[0].click(); return "reaction_link"; }
    // Try aria-label with reaction
    const ariaEls = document.querySelectorAll<HTMLElement>('[aria-label]');
    for (const el of ariaEls) {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (aria.includes("reaction") || aria.includes("تفاعل")) { el.click(); return "aria"; }
      if (/^\d+([.,]\d+)*[kKmM]?(\s|$)/.test(aria)) { el.click(); return "number"; }
    }
    return null;
  });
  console.log(`  Dialog clicked: ${dialogClicked}`);
  await page.waitForTimeout(4000);
  console.log(`  New GraphQL requests: ${allRequests.length - beforeReactions}`);

  // Print NEW requests from phases 2&3
  console.log(`\n=== ALL REQUESTS (total: ${allRequests.length}) ===`);
  for (let i = 0; i < allRequests.length; i++) {
    const r = allRequests[i];
    const phase = i < beforeComments ? "LOAD" : i < beforeReactions ? "COMMENTS" : "REACTIONS";
    console.log(`\n  [${i}] (${phase}) doc_id=${r.doc_id}`);
    console.log(`      url=${r.url.substring(0, 100)}`);
    if (r.variables) {
      const keys = Object.keys(r.variables).join(", ");
      const vStr = JSON.stringify(r.variables).substring(0, 200);
      console.log(`      keys: ${keys}`);
      const hasCursor = vStr.includes("cursor") || vStr.includes("after");
      const hasReaction = vStr.includes("reaction") || vStr.includes("reactor");
      const hasComment = vStr.includes("comment") || vStr.includes("feedback");
      if (hasCursor) console.log(`      ⭐ CURSOR: ${vStr.match(/"(?:cursor|after)"\s*:\s*"([^"]+)"/)?.[1]?.substring(0, 30)}`);
      if (hasReaction) console.log(`      ⭐ REACTION request!`);
      if (hasComment) console.log(`      ⭐ COMMENT/feedback request!`);
      console.log(`      variables(first 200): ${vStr}`);
    }
  }

  // Check which requests have paginated responses
  console.log(`\n=== RESPONSES WITH PAGINATION/USERS ===`);
  respIdx = 0;
  let dumpCount = 0;
  for (const [rKey, rBody] of allResponses) {
    const hasUsers = /profile\.php\?id=\d{5,25}/.test(rBody);
    const hasPageInfo = /"has_next_page"\s*:\s*(true|false)/.test(rBody) || /"end_cursor"/.test(rBody);
    const hasEdges = /"edges"\s*:/.test(rBody);
    const hasCommentText = /"comment_text"/.test(rBody) || /"body"\s*:\s*\{[^}]*"text"/.test(rBody);
    const hasReactors = /"reactors"\s*:/.test(rBody) || /"reactions"\s*:/.test(rBody);
    if (hasUsers || hasPageInfo || hasEdges || hasCommentText || hasReactors) {
      console.log(`\n  [resp #${respIdx}] users=${hasUsers} pageInfo=${hasPageInfo} edges=${hasEdges} comment=${hasCommentText} reactors=${hasReactors}`);
      if (hasUsers) {
        const match = rBody.match(/profile\.php\?id=(\d{5,25})/);
        console.log(`      sample profile.php?id=${match?.[1]}`);
      }
      if (hasPageInfo) {
        const cursorMatch = rBody.match(/"end_cursor"\s*:\s*"([^"]+)"/);
        const hasNext = /"has_next_page"\s*:\s*true/.test(rBody);
        console.log(`      cursor=${cursorMatch?.[1]?.substring(0, 30)} hasNext=${hasNext}`);
      }
      // DUMP reactions/comments responses for inspection
      if (dumpCount < 8) {
        fs.writeFileSync(`probe-response-${dumpCount}.json`, rBody);
        console.log(`      >>> DUMPED probe-response-${dumpCount}.json (len=${rBody.length})`);
        dumpCount++;
      }
    }
    respIdx++;
  }

  console.log(`\n=== DONE ===`);
  await browser.close();
}
main().catch(console.error);

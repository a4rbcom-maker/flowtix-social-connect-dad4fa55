/** Capture ALL network traffic while scrolling the IG followers dialog —
 *  find the real pagination endpoint. Run: npx tsx src/debug-ig-net.ts <sessionId> <username> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3] || "tourismegypt";
  if (!sessionId) throw new Error("usage: debug-ig-net <sessionId> <username>");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);

  const hits: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("instagram.com")) return;
    if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|mp4|gif|ico)(\?|$)/i.test(url)) return;
    const u = new URL(url);
    let vars = u.searchParams.get("variables") || "";
    if (!vars && req.method() === "POST") {
      try { vars = new URLSearchParams(req.postData() || "").get("variables") || (req.postData() || "").slice(0, 150); } catch { /* ignore */ }
    }
    hits.push(`${req.method()} ${u.pathname}${vars ? ` VARS=${vars.slice(0, 200)}` : ""}`);
  });

  try {
    await page.goto(`${config.igBaseUrl}/${username}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await page.waitForTimeout(3500);
    hits.length = 0; // only traffic from now on: dialog + scrolls

    const clicked = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('header a, main a, header button, [role="button"]')) as HTMLElement[];
      for (const el of cands) {
        const txt = (el.textContent || "").trim();
        if (txt && txt.length < 40 && /\d/.test(txt) && /followers/i.test(txt)) { el.click(); return txt; }
      }
      return null;
    });
    console.log("dialog click:", clicked);
    await page.waitForTimeout(4000);
    console.log("--- after dialog open:", hits.length, "requests ---");
    for (const h of hits.slice(0, 8)) console.log("  ", h);

    // Direct pagination probe: call the SAME friendships endpoint the dialog
    // used, WITH a page-2 cursor (next_max_id from response 1). If the API
    // honors max_id directly we have full-speed pagination without the DOM.
    const probe = await page.evaluate(async () => {
      const res1 = await fetch("https://www.instagram.com/api/v1/friendships/38437859083/followers/?count=50", {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const j1 = await res1.json().catch(() => null);
      if (!j1) return { step: "page1_parse_fail", status: res1.status };
      const firstUser = j1.users?.[0]?.username ?? null;
      const nextMaxId = j1.next_max_id ?? null;
      if (!nextMaxId) return { step: "page1_ok_no_cursor", status: res1.status, count: j1.users?.length, firstUser };
      const res2 = await fetch(`https://www.instagram.com/api/v1/friendships/38437859083/followers/?count=50&max_id=${encodeURIComponent(nextMaxId)}`, {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const j2 = await res2.json().catch(() => null);
      const secondUser = j2?.users?.[0]?.username ?? null;
      return { step: "page2", status: res2.status, page1Count: j1.users?.length, firstUser, secondUser, distinctFirstUsers: firstUser !== secondUser, page2Count: j2?.users?.length ?? 0 };
    }).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("PAGINATION PROBE:", JSON.stringify(probe));

    // Bigger pages? 100/200 per request + timing
    const bigProbe = await page.evaluate(async () => {
      const t0 = Date.now();
      const res = await fetch("https://www.instagram.com/api/v1/friendships/38437859083/followers/?count=200", {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const j: any = await res.json().catch(() => null);
      const elapsed = Date.now() - t0;
      if (!j?.users) return { status: res.status, elapsed, sample: JSON.stringify(j).slice(0, 150) };
      const u0 = j.users[0];
      return { status: res.status, elapsed, count: j.users.length, next: !!j.next_max_id, sampleUser: { u: u0.username, pk: u0.pk, full: u0.full_name, img: !!u0.profile_pic_url, isPrivate: u0.is_private, verified: u0.is_verified } };
    }).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("BIG PAGE PROBE:", JSON.stringify(bigProbe));

    // following endpoint works the same way?
    const followingProbe = await page.evaluate(async () => {
      const res = await fetch("https://www.instagram.com/api/v1/friendships/38437859083/following/?count=50", {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const j: any = await res.json().catch(() => null);
      return { status: res.status, count: j?.users?.length ?? 0, next: !!j?.next_max_id, first: j?.users?.[0]?.username ?? null };
    }).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("FOLLOWING PROBE:", JSON.stringify(followingProbe));

    // Where does the numeric id come from? Test resolving it from the
    // profile page's embedded Polaris user JSON (works without web_profile_info)
    const idProbe = await page.evaluate(async (user: string) => {
      const res = await fetch(`https://www.instagram.com/${user}/`, { credentials: "include" });
      const html = await res.text();
      const patterns = [/"user_id":"(\d+)"/, /"userID":"(\d+)"/, /"id":"(\d+)","username"/, /"username":"[^"]*","id":"(\d+)"/, /profile_user.*(\d{10,})/, /"pk":"(\d+)"/, /viewerId.*?(\d{10,})/];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return { found: true, pattern: String(re), id: m[1], len: html.length };
      }
      // dump a window around the username to see the real shape
      const idx = html.indexOf(`"${username}"`);
      return { found: false, len: html.length, context: idx >= 0 ? html.slice(Math.max(0, idx - 120), idx + 80) : "username-not-in-html" };
    }, username).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("ID RESOLVE PROBE:", JSON.stringify(idProbe));

    // Full end-to-end speed test: 5 consecutive pages via max_id (rate ~)
    const speedProbe = await page.evaluate(async () => {
      const results: unknown[] = [];
      let maxId: string | null = null;
      const t0 = Date.now();
      let total = 0;
      for (let i = 0; i < 5; i++) {
        const url = `https://www.instagram.com/api/v1/friendships/38437859083/followers/?count=50${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`;
        const res: Response = await fetch(url, { credentials: "include", headers: { "x-ig-app-id": "936619743392459", accept: "*/*" } });
        if (res.status !== 200) { results.push({ page: i + 1, status: res.status }); break; }
        const j = await res.json();
        total += (j.users || []).length;
        maxId = j.next_max_id ?? null;
        results.push({ page: i + 1, got: (j.users || []).length, total, cursor: !!maxId });
        if (!maxId) break;
        await new Promise((r) => setTimeout(r, 700)); // gentle pacing 0.7s
      }
      return { elapsedMs: Date.now() - t0, pages: results, totalUsers: total, ratePerMin: Math.round((total / (Date.now() - t0)) * 60000) };
    }).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("SPEED PROBE:", JSON.stringify(speedProbe));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

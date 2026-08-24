/** Live probe: what GraphQL queries does an IG followers dialog issue?
 *  Run: npx tsx src/debug-ig-graphql.ts <sessionId> <username> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3] || "tourismegypt";
  if (!sessionId) throw new Error("usage: debug-ig-graphql <sessionId> <username>");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);

  const gqlHits: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/graphql/query")) {
      const u = new URL(url);
      const friendly = u.searchParams.get("fb_api_req_friendly_name") || "(no-name)";
      const docId = u.searchParams.get("doc_id") || "-";
      let vars = (u.searchParams.get("variables") || "");
      if (!vars) { const raw = req.postData(); if (raw) { try { const pd = new URLSearchParams(raw); vars = pd.get("variables") || ""; } catch { vars = ""; } } }
      gqlHits.push(`${friendly} doc_id=${docId} path=${u.pathname} vars=${vars.slice(0, 260)}`);
    }
  });
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("/graphql/query")) {
      try {
        const body = await resp.text();
        console.log("FOLLOWERS RESPONSE snippet:", body.slice(0, 400));
      } catch { /* body gone */ }
    }
  });

  try {
    await page.goto(`${config.igBaseUrl}/${username}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await page.waitForTimeout(3500);
    console.log("captured after profile load:", gqlHits.length);

    // Open the followers dialog (text counter click — new DOM)
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
    console.log("captured after dialog open:", gqlHits.length);
    console.log("friendly names:"); for (const h of gqlHits.slice(0, 8)) console.log("  ", h);

    // Try the classic __a=1 followers API (legacy but often still alive)
    // Resolve user id from the page's own window state (present on profile pages)
    const probe = await page.evaluate(async (user: string) => {
      // window._cuger / meta tags carry the id on profile pages
      const meta = document.querySelector('meta[property="al:ios:url"]')?.getAttribute("content") || "";
      const m = meta.match(/user\/(\d+)/); let id = m ? m[1] : null;
      if (!id) {
        const anyWin = window as any;
        // Dig for a numeric user id in any embedded JSON state blob
        const html = document.documentElement.innerHTML;
        const m2 = html.match(/"user_id":"(\d+)"/) || html.match(/"owner":\{"id":"(\d+)"\}/) || html.match(/"pk":"(\d+)"/);
        id = m2 ? m2[1] : (anyWin.__cuger?.userID || null);
      }
      if (!id) return { step: "id_from_dom", id: null, meta, has_window_cuger: !!(window as any).__cuger, snippet: document.documentElement.innerHTML.match(/"user_id"[^,]{0,40}/)?.[0] || "none" };
      const res = await fetch(`https://www.instagram.com/api/v1/friendships/${id}/followers/?count=50`, {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        const u0 = j.users && j.users[0];
        return { step: "followers", status: res.status, id, count: (j.users || []).length, sample: u0 ? `${u0.username} (${u0.full_name})` : "none", next_max_id: j.next_max_id || null };
      } catch {
        return { step: "followers_parse", status: res.status, id, sample: text.slice(0, 200) };
      }
    }, username).catch((e) => ({ error: String(e).slice(0, 200) }));
    console.log("friendships probe:", JSON.stringify(probe));

    // THE key experiment: xdt followers via __a=1&polaris (relay-style, named template)
    const gqlProbe = await page.evaluate(async (user: string) => {
      const body = new URLSearchParams();
      body.set("av", "0");
      body.set("__d", "www");
      body.set("__user", "0");
      body.set("__a", "1");
      body.set("__req", "p");
      body.set("__hs", "19910.HYP%3Ainstagram_web_pkg.2.1..0.0");
      body.set("dpr", "1");
      body.set("__ccg", "UNKNOWN");
      body.set("variables", JSON.stringify({ after: null, include_reel_media_seen_timestamp: true, include_relationship_info: true, latest_besties_reel_media: false, latest_reel_media: false, first: 24 }));
      body.set("server_timestamps", "true");
      const res = await fetch("https://www.instagram.com/graphql/query/?query_hash=c76146cf9928be1a2d0d17cb0d1c0f5c&variables=" + encodeURIComponent(JSON.stringify({ id: "38437859083", first: 24, after: null })), {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
      });
      const text = await res.text();
      return { status: res.status, sample: text.slice(0, 250) };
    }, username).catch((e) => ({ error: String(e).slice(0, 150) }));
    console.log("legacy query_hash probe:", JSON.stringify(gqlProbe));

  } finally {
    await igContextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

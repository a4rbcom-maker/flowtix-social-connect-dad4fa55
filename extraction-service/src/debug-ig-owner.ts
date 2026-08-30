/** Probe v5: OWNERSHIP test. For each post, read the owner username from the
 *  embedded JSON, compare against the logged-in session username, and see how
 *  many likers the /likers/ endpoint + GraphQL liked-by query expose.
 *  Hypothesis: IG exposes the FULL liker list only to the post OWNER.
 *  Run: npx tsx src/debug-ig-owner.ts <sessionId> <shortcodeA> <shortcodeB> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function probe(page: import("playwright").Page, shortcode: string) {
  await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(`(() => {
    const html = document.documentElement.innerHTML;
    const owner = html.match(/"owner":\\{"[^}]*?"username":"([^"]+)"/) || html.match(/"username":"([^"]+)"[^}]*?"is_verified"/);
    const idm = html.match(/"id":"(\\d+)_(\\d+)"/);
    const like = html.match(/"edge_media_preview_like":\\{"count":(\\d+)/) || html.match(/"like_count":(\\d+)/);
    return { owner: owner ? owner[1] : null, mediaId: idm ? idm[1] : null, likeCount: like ? Number(like[1]) : null };
  })()`).then(r=>r as {owner:string|null;mediaId:string|null;likeCount:number|null}).catch(() => null);
  const rest = await page.evaluate(`(async () => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
    const r = await fetch("https://www.instagram.com/api/v1/media/${info?.mediaId}/likers/", { credentials: "include", headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" } });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { status: 200, user_count: j.user_count, returned: (j.users||[]).length };
  })()`).then(r=>r as Record<string,unknown>).catch(() => ({}));
  return { shortcode, ...info, rest };
}

async function main() {
  const sessionId = process.argv[2];
  const codes = process.argv.slice(3);
  if (!codes.length) codes.push("DcqY-5Hu8Wm", "Dcgbl98jAve");
  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);
  try {
    const me = await page.evaluate(`(() => (document.cookie.match(/ds_user_id=([^;]+)/)||[])[1] || null)()`).catch(()=>null);
    console.log("logged-in ds_user_id:", me);
    for (const c of codes) {
      const r = await probe(page, c);
      console.log(JSON.stringify(r));
    }
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

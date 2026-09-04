/**
 * Diagnostic 3: test /api/v1/media/{pk}/comments/ via in-page fetch (session
 * cookies) with next_max_id pagination + test known XDT comments doc_ids.
 * Prints which path returns 200 and how many comments paginate.
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

// post Dc1LGfkITiZ → media pk 3978134670572337305 (verified: base64 decode == og:ios:url media id)
const MEDIA_PK = "3978134670572337305";

async function main() {
  const sessionId = process.argv[2];
  await browserPool.init();
  const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, proxy, userAgent);
  const page = created.page;
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ---- Path A: private media comments endpoint, paginate next_max_id ----
    const snippet = `(async () => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const all = new Map();
      let maxId = null;
      let pages = 0;
      let errStatus = null;
      for (let i = 0; i < 25; i++) {
        const url = "https://www.instagram.com/api/v1/media/${MEDIA_PK}/comments/?can_support_threading=true&permalink_enabled=false" + (maxId ? "&next_max_id=" + encodeURIComponent(maxId) : "");
        try {
          const res = await fetch(url, {
            credentials: "include",
            headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" },
          });
          if (!res.ok) { errStatus = res.status; break; }
          const j = await res.json();
          const arr = j.comments || [];
          for (const c of arr) {
            if (c.user && c.user.username && !all.has(c.user.username)) {
              all.set(c.user.username, { u: c.user.username, text: String(c.text ?? "").slice(0, 40), id: String(c.pk ?? c.id ?? "") });
            }
          }
          pages++;
          maxId = j.next_max_id ?? null;
          if (!maxId) break;
          await new Promise((r) => setTimeout(r, 1200));
        } catch (e) { errStatus = String(e).slice(0, 60); break; }
      }
      return { ok: true, pages, unique: all.size, errStatus, sample: [...all.values()].slice(0, 3), lastText: [...all.values()].pop()?.text ?? null };
    })()`;
    const a = await page.evaluate(snippet).then((r) => r as { pages: number; unique: number; errStatus?: unknown; sample?: unknown[] }).catch(() => null);
    console.log("PATH A (media comments API):", JSON.stringify(a));

    // ---- Path B: try known comments doc_ids (single page each) ----
    const docIds = [
      "9361150124142511", // PolarisPostCommentsByShortcodeQuery (old)
      "9510064595728286", // candidate
      "8845758582086843", // PolarisPostActionLoadPostQueryQuery
      "7718917694045330", // candidate
    ];
    for (const doc of docIds) {
      const s2 = `(async () => {
        const params = new URLSearchParams({
          doc_id: "${doc}",
          variables: JSON.stringify({ shortcode: "Dc1LGfkITiZ", first: 50 }),
          fb_api_req_friendly_name: "PolarisPostCommentsByShortcodeQuery",
        });
        try {
          const res = await fetch("https://www.instagram.com/graphql/query/?" + params.toString(), {
            credentials: "include", headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
          });
          if (!res.ok) return { status: res.status };
          const j = await res.json();
          const xdt = j?.data?.xdt_shortcode_media;
          const conn = xdt && (xdt.edge_media_to_comment_thread_or_show_more_edge_or_toplined_comments || xdt.edge_media_to_parent_comment || xdt.edge_media_to_comment);
          return { status: 200, hasXdt: !!xdt, edges: conn?.edges?.length ?? 0, count: conn?.count ?? null, hasNext: !!conn?.page_info?.has_next_page };
        } catch (e) { return { status: String(e).slice(0, 40) }; }
      })()`;
      const r = await page.evaluate(s2).then((x) => x as Record<string, unknown>).catch(() => null);
      console.log(`PATH B doc_id=${doc}:`, JSON.stringify(r));
    }
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

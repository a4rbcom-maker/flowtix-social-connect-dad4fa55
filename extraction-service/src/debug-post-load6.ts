/**
 * Diagnostic 6: full pagination on the media comments API using the returned
 * next_min_id as the next request's min_id — measure how many unique commenters
 * we can walk on post Dc1LGfkITiZ (total=199 per comment_count).
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

const MEDIA_PK = "3978134670572337305";

async function main() {
  const sessionId = process.argv[2];
  await browserPool.init();
  const { cookies } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies);
  const page = created.page;
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const s = `(async () => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const all = new Map();
      let minId = null;
      let pages = 0;
      let lastInfo = null;
      for (let i = 0; i < 30; i++) {
        const url = "https://www.instagram.com/api/v1/media/${MEDIA_PK}/comments/?can_support_threading=true&permalink_enabled=false" + (minId ? "&min_id=" + encodeURIComponent(minId) : "");
        const res = await fetch(url, {
          credentials: "include", headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" },
        });
        if (!res.ok) { lastInfo = "status " + res.status; break; }
        const j = await res.json();
        const arr = j.comments || [];
        for (const c of arr) if (c.user && c.user.username && !all.has(c.user.username)) all.set(c.user.username, String(c.text ?? "").slice(0, 30));
        pages++;
        // progress: next_min_id present means there IS a further page
        const nmi = typeof j.next_min_id === "string" ? j.next_min_id : (j.next_min_id && j.next_min_id.bifilter_token) || null;
        lastInfo = { page: pages, got: arr.length, unique: all.size, count: j.comment_count, more: j.has_more_comments, nmi: nmi ? nmi.slice(0, 25) : null };
        console.log("PAGE " + pages + ":", JSON.stringify(lastInfo));
        if (!nmi || pages > 28) break;
        minId = nmi;
        await new Promise((r) => setTimeout(r, 1300));
      }
      return { pages, unique: all.size, lastInfo };
    })()`;
    const r = await page.evaluate(s).then((x) => x as Record<string, unknown>).catch((e) => ({ err: String(e).slice(0, 80) }));
    console.log("RESULT:", JSON.stringify(r, null, 1));
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

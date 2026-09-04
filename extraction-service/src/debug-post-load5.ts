/**
 * Diagnostic 5: the first comments API call is the RANKED PREVIEW (6 comments,
 * has_more_comments, next_min_id=bifilter token). The full list is the
 * "headload" — try pagination variants: next_max_id=next_min_id, min_id,
 * max_id, and the comments panel URL params (?next_max_id&target_comment_id).
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

const MEDIA_PK = "3978134670572337305";

async function main() {
  const sessionId = process.argv[2];
  await browserPool.init();
  const { cookies } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, undefined, userAgentSafe());
  const page = created.page;
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const variants: Array<[string, string]> = [
      ["base", "?can_support_threading=true&permalink_enabled=false"],
      ["min_id_from_bifilter", "?can_support_threading=true&permalink_enabled=false&min_id="], // filled dynamically below
      ["next_max_id_from_bifilter", "?can_support_threading=true&permalink_enabled=false&next_max_id="],
      ["comments_panel_v2", "?can_support_threading=true&permalink_enabled=false&page_size=50&sort_order=popular"],
    ];
    // get the bifilter token first
    const token = await page.evaluate(`(async () => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const res = await fetch("https://www.instagram.com/api/v1/media/${MEDIA_PK}/comments/?can_support_threading=true&permalink_enabled=false", {
        credentials: "include", headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" },
      });
      const j = await res.json();
      return { nextMinId: typeof j.next_min_id === "string" ? j.next_min_id : (j.next_min_id && j.next_min_id.bifilter_token) || null, hasMore: j.has_more_comments };
    })()`).then((r) => r as { nextMinId: string | null; hasMore: boolean }).catch(() => ({ nextMinId: null, hasMore: false }));
    console.log("first-page token:", token);

    for (const [name, base] of variants) {
      let url = `https://www.instagram.com/api/v1/media/${MEDIA_PK}/comments/${base}`;
      if (name === "min_id_from_bifilter" && token.nextMinId) url += encodeURIComponent(token.nextMinId);
      if (name === "next_max_id_from_bifilter" && token.nextMinId) url += encodeURIComponent(token.nextMinId);
      const s = `(async () => {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
        try {
          const res = await fetch(${JSON.stringify(url)}, {
            credentials: "include", headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" },
          });
          if (!res.ok) return { status: res.status };
          const j = await res.json();
          return {
            status: 200,
            count: (j.comments || []).length,
            commentCount: j.comment_count ?? null,
            hasMoreComments: j.has_more_comments ?? null,
            nextMaxId: j.next_max_id ? String(j.next_max_id).slice(0, 30) : null,
            nextMinId: j.next_min_id ? "present" : null,
            isRanked: j.is_ranked ?? null,
            firstUser: j.comments?.[0]?.user?.username ?? null,
          };
        } catch (e) { return { err: String(e).slice(0, 60) }; }
      })()`;
      const r = await page.evaluate(s).then((x) => x as Record<string, unknown>).catch((e) => ({ err: String(e).slice(0, 60) }));
      console.log(name, "→", JSON.stringify(r));
    }
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

function userAgentSafe(): string | null { return null; }

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

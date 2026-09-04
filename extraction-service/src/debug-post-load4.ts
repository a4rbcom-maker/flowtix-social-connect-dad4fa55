/**
 * Diagnostic 4: inspect the raw first response of /api/v1/media/{pk}/comments/
 * — does it carry a next_max_id? child_comments? what are the pagination keys?
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

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
    const s = `(async () => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const res = await fetch("https://www.instagram.com/api/v1/media/${MEDIA_PK}/comments/?can_support_threading=true&permalink_enabled=false", {
        credentials: "include",
        headers: { "x-ig-app-id": "936619743392459", "x-csrftoken": csrf, "x-requested-with": "XMLHttpRequest", accept: "*/*" },
      });
      if (!res.ok) return { status: res.status };
      const j = await res.json();
      const topKeys = Object.keys(j);
      const childComments = (j.comments || []).filter((c) => (c.child_comment_count ?? 0) > 0).length;
      const previews = (j.comments || []).filter((c) => c.has_liked_comment !== undefined && c.comment_count !== undefined).length;
      return {
        status: 200,
        topKeys,
        commentCount: (j.comments || []).length,
        nextMaxId: j.next_max_id ? String(j.next_max_id).slice(0, 40) : null,
        nextMinId: j.next_min_id ?? null,
        hasMore: j.has_more ?? null,
        childComments,
        previewLikeRows: previews,
        globalCountKeys: { comment_count: j.comment_count, preview_comments: j.preview_comments ? "present" : null },
        sample: (j.comments || []).slice(0, 2).map((c) => ({ user: c.user?.username, pk: c.pk, child: c.child_comment_count ?? 0, preview_children: (c.preview_child_comments || []).length })),
      };
    })()`;
    const r = await page.evaluate(s).then((x) => x as Record<string, unknown>).catch((e) => ({ err: String(e).slice(0, 80) }));
    console.log(JSON.stringify(r, null, 1));
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

/**
 * Live probe for the ig_post_commenters fix (2026-09-04).
 * Post Dc1LGfkITiZ yielded 8 of 182 comments (job 4912ca35).
 *
 * Strategy: capture the comments GraphQL query the IG web app ITSELF sends
 * when the post page opens / "View all" is clicked (doc_id rotates — hardcoded
 * 9361150124142511 now 400s), then replay that captured template with real
 * cursor pagination — the proven captureLikersTemplate pattern.
 *
 *   npx tsx src/probe-dc1lgf.ts <igSessionId> [shortcode]
 *
 * Exit 0 = coverage >= 70% of the post's true comment count. Exit 1 = fail.
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";
import type { Request } from "playwright";

const TARGET_COVERAGE = 0.7;

interface CapturedQuery {
  url: string;
  docId: string;
  friendlyName: string;
  variables: Record<string, unknown>;
  headers: Record<string, string>;
}

async function main() {
  const sessionId = process.argv[2];
  const shortcode = process.argv[3] ?? "Dc1LGfkITiZ";
  if (!sessionId) throw new Error("usage: probe-dc1lgf <igSessionId> [shortcode]");

  await browserPool.init();
  const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, proxy, userAgent);
  const page = created.page;

  try {
    // 1) True totals WITHOUT login: og:description exposes "X likes, Y comments".
    await page.goto(`https://www.instagram.com/p/${shortcode}/?embed=true`, {
      waitUntil: "domcontentloaded", timeout: 30_000,
    }).catch(() => {});
    const og = await page.evaluate(`(() => {
      const m = document.querySelector('meta[property="og:description"]');
      return m ? m.content : "";
    })()`).then((r) => r as string).catch(() => "");
    const mComments = og.match(/([\d,.]+)\s*comments?/i);
    const postTotal = mComments ? Number(mComments[1].replace(/[,.]/g, "")) : null;
    console.log("POST_TOTAL:", postTotal, "(og:", og.slice(0, 70), ")");

    // 2) Capture every graphql request the app sends on the post page.
    const captured: CapturedQuery[] = [];
    const seenDocs = new Set<string>();
    const onRequest = (req: Request): void => {
      try {
        const u = new URL(req.url());
        if (!u.pathname.includes("/graphql/query")) return;
        const sp = u.searchParams;
        const form = new URLSearchParams(req.method() === "POST" ? req.postData() ?? "" : "");
        const docId = sp.get("doc_id") || form.get("doc_id") || "";
        const varsRaw = sp.get("variables") || form.get("variables") || "";
        const friendly = sp.get("fb_api_req_friendly_name") || form.get("fb_api_req_friendly_name") || "";
        if (!docId) return;
        let vars: Record<string, unknown> = {};
        try { vars = JSON.parse(varsRaw) as Record<string, unknown>; } catch { return; }
        const key = docId + friendly;
        if (seenDocs.has(key)) return;
        seenDocs.add(key);
        captured.push({
          url: `${u.origin}${u.pathname}`,
          docId,
          friendlyName: friendly,
          variables: vars,
          headers: {
            "x-ig-app-id": req.headers()["x-ig-app-id"] ?? "936619743392459",
            "x-csrftoken": req.headers()["x-csrftoken"] ?? "",
            "x-fb-lsd": req.headers()["x-fb-lsd"] ?? "",
            "x-asbd-id": req.headers()["x-asbd-id"] ?? "",
          },
        });
      } catch { /* never throw */ }
    };
    page.on("request", onRequest);

    await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, {
      waitUntil: "domcontentloaded", timeout: 30_000,
    });
    await page.waitForTimeout(3000);
    // Click "View all N comments" / load-more to trigger the comments query.
    for (let attempt = 0; attempt < 5; attempt++) {
      const clicked = await page.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('span, div[role="button"], button, a'));
        for (const b of btns) {
          const t = (b.textContent || "").trim();
          if (/((view|see) all|all \\d+|comments|عرض|مزيد|تحميل|load more|MORE)/i.test(t) && t.length < 60) { b.click(); return t; }
        }
        return null;
      })()`).then((r) => r as string | null).catch(() => null);
      if (!clicked) break;
      await page.waitForTimeout(2000);
    }
    await page.waitForTimeout(2000);
    page.off("request", onRequest);

    console.log("CAPTURED QUERIES:");
    for (const c of captured) {
      console.log(`  doc_id=${c.docId} | ${c.friendlyName} | vars=${JSON.stringify(c.variables).slice(0, 110)}`);
    }

    // 3) Pick comment-shaped queries: mention the shortcode (or a comment_id)
    const commentQueries = captured.filter((c) =>
      /comment/i.test(c.friendlyName) || JSON.stringify(c.variables).includes(shortcode),
    );
    console.log("comment-shaped candidates:", commentQueries.map((c) => c.docId + "/" + c.friendlyName).join(", ") || "NONE");

    // 4) Replay each candidate with cursor pagination until one paginates.
    const collected = new Map<string, { username: string; commentText: string; commentId: string }>();
    let totalFromApi: number | null = null;
    let exhausted = false;
    let winningDocId: string | null = null;

    for (const tpl of commentQueries.slice(0, 6)) {
      collected.clear();
      totalFromApi = null;
      exhausted = false;
      let after: string | null =
        (typeof tpl.variables.after === "string" ? tpl.variables.after : null);
      // normalize: strip cursor for a fresh replay
      const vars0 = { ...tpl.variables };
      delete vars0.after;
      if (!("first" in vars0) && !("after" in vars0) && !("comment_id" in vars0)) {
        vars0.first = 50;
      }
      console.log(`\nREPLAY doc_id=${tpl.docId} (${tpl.friendlyName})`);
      for (let pageIdx = 0; pageIdx < 200; pageIdx++) {
        const snippet = `(async () => {
          const params = new URLSearchParams({
            doc_id: ${JSON.stringify(tpl.docId)},
            variables: JSON.stringify({ ...${JSON.stringify(vars0)}, after: ${JSON.stringify(after)} }),
            fb_api_req_friendly_name: ${JSON.stringify(tpl.friendlyName)},
          });
          try {
            const res = await fetch(${JSON.stringify(tpl.url)} + "?" + params.toString(), {
              credentials: "include",
              headers: ${JSON.stringify(tpl.headers)},
            });
            if (!res.ok) return { error: true, status: res.status };
            const text = await res.text();
            let body;
            try { body = JSON.parse(text); } catch (e) { return { error: true, status: 0 }; }
            const xdt = body && body.data && body.data.xdt_shortcode_media;
            const conn = xdt && (xdt.edge_media_to_comment_thread_or_show_more_edge_or_toplined_comments
              || xdt.edge_media_to_parent_comment || xdt.edge_media_to_comment);
            // also walk generic edges for comment shapes (app templates vary)
            const edges = (conn && conn.edges) || [];
            const comments = [];
            for (const e of edges) {
              const n = e && e.node;
              if (!n) continue;
              if (n.__typename === "GraphTombstone" || n.text === "...") continue;
              const owner = n.owner;
              if (!owner || !owner.username) continue;
              comments.push({ id: String(n.id ?? ""), text: String(n.text ?? ""), username: String(owner.username) });
            }
            const pageInfo = (conn && conn.page_info) || {};
            return {
              comments,
              endCursor: pageInfo.end_cursor ?? null,
              hasNext: !!pageInfo.has_next_page,
              total: (conn && conn.count != null) ? Number(conn.count) : null,
            };
          } catch (e) {
            return { error: true, status: 0, message: String(e).slice(0, 100) };
          }
        })()`;

        const result = await page.evaluate(snippet).then((r) => r as {
          error?: boolean; status?: number;
          comments?: { id: string; text: string; username: string }[];
          endCursor?: string | null; hasNext?: boolean; total?: number | null;
        }).catch(() => null);

        if (!result || result.error || !result.comments?.length) {
          console.log(`  PAGE ${pageIdx}: stop (status=${result?.status ?? "?"}, got=${result?.comments?.length ?? 0})`);
          break;
        }
        if (!totalFromApi && result.total != null && result.total > 0) totalFromApi = result.total;
        let added = 0;
        for (const c of result.comments) {
          if (!collected.has(c.username)) {
            collected.set(c.username, { username: c.username, commentText: c.text, commentId: c.id });
            added++;
          }
        }
        console.log(`  PAGE ${pageIdx}: +${added} → ${collected.size} unique (hasNext=${result.hasNext})`);
        if (!result.hasNext || !result.endCursor) { exhausted = true; break; }
        after = result.endCursor;
        await page.waitForTimeout(1200);
      }
      if (collected.size > 3 && (exhausted || collected.size >= 50)) {
        winningDocId = tpl.docId;
        break;
      }
    }

    // 5) Verdict
    const total = totalFromApi ?? postTotal ?? 0;
    const coverage = total > 0 ? collected.size / total : 0;
    console.log("=====");
    console.log(`winning doc_id: ${winningDocId}`);
    console.log(`post total=${total} (api=${totalFromApi}, og=${postTotal})`);
    console.log(`harvested=${collected.size} unique | exhausted=${exhausted}`);
    console.log(`coverage=${(coverage * 100).toFixed(1)}%`);
    console.log(coverage >= TARGET_COVERAGE ? "COVERAGE PASS ✅ (>=70%)" : "COVERAGE FAIL ❌ (<70%)");
    process.exit(coverage >= TARGET_COVERAGE ? 0 : 1);
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

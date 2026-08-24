/** Capture the FULL hashtag graphql request (headers+body) to replicate it.
 *  Run: npx tsx src/debug-ig-tagreq.ts <sessionId> <tag> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

async function main() {
  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(process.argv[2]);
  const { page, contextId } = await igContextManager.createContext(process.argv[2], cookies, undefined, userAgent);
  try {
    await page.goto(`https://www.instagram.com/explore/tags/${process.argv[3]}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    // scroll to trigger pagination
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(2000);
    }

    // Now replay the LAST captured media request with its own variables but
    // after=<captured end_cursor> — full request fidelity (doc_id included).
    const probe = await page.evaluate(async (tag: string) => {
      // find relay environment: doc_id lives in the page's bundled modules;
      // instead of guessing, re-issue the EXACT fetch the app uses by
      // reading window.__relay_env or falling back to the known public doc_id
      const anyWin = window as any;
      const candidates = [
        "1001590184267", // PolarisTagFeedQuery (public web)
        "9510064595738812",
      ];
      const results: unknown[] = [];
      for (const docId of candidates) {
        try {
          const body = new URLSearchParams();
          body.set("doc_id", docId);
          body.set("variables", JSON.stringify({ tag_name: tag, after: null, first: 24 }));
          const res = await fetch("https://www.instagram.com/graphql/query", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/x-www-form-urlencoded", "x-ig-app-id": "936619743392459" },
            body: body.toString(),
          });
          const text = await res.text();
          const jsonText = text.startsWith("for (;;);") ? text.slice(9) : text;
          let parsed: unknown = null;
          try { parsed = JSON.parse(jsonText); } catch { /* html */ }
          const j = parsed as Record<string, unknown> | null;
          const status = j?.status ?? (text.slice(0, 80));
          const dataKeys = j?.data ? Object.keys(j.data as object) : [];
          results.push({ docId, httpStatus: res.status, status, dataKeys });
        } catch (e) {
          results.push({ docId, error: String(e).slice(0, 80) });
        }
      }
      return results;
    }, process.argv[3]).catch((e) => ({ error: String(e).slice(0, 120) }));
    console.log(JSON.stringify(probe, null, 1));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });

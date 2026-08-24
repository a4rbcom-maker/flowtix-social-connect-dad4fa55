/** Capture the hashtag pagination request VERBATIM, then replay it with a
 *  new after-cursor. Run: npx tsx src/debug-ig-tagreplay.ts <sessionId> <tag> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

interface ReqInfo {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

async function main() {
  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(process.argv[2]);
  const { page, contextId } = await igContextManager.createContext(process.argv[2], cookies, undefined, userAgent);

  const mediaReqs: ReqInfo[] = [];
  const handler = (req: import("playwright").Request): void => {
    try {
      const url = req.url();
      if (!(url.includes("/api/graphql") || url.includes("/graphql/query"))) return;
      const body = req.postData() || "";
      // capture ALL graphql POSTs — inspect offline which one carries the feed
      if (!body) return;
      const headers: Record<string, string> = {};
      for (const h of ["x-ig-app-id", "x-fb-friendly-name", "x-asbd-id", "x-csrf-token", "content-type", "sec-fetch-site"]) {
        const v = req.headers()[h];
        if (v) headers[h] = v;
      }
      mediaReqs.push({ url, method: req.method(), headers, body });
    } catch { /* never throw */ }
  };
  page.on("request", handler as never);

  try {
    await page.goto(`https://www.instagram.com/explore/tags/${process.argv[3]}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(2200);
    }
    console.log("captured graphql requests:", mediaReqs.length);
    for (const r of mediaReqs) {
      const params = new URLSearchParams(r.body || "");
      const vars = (params.get("variables") || "").slice(0, 120);
      console.log("  -", r.headers["x-fb-friendly-name"] ?? "(none)", "|", vars);
    }
    if (mediaReqs.length === 0) return;

    // Find the pagination query by friendly name
    const template = mediaReqs.find((r) => r.headers["x-fb-friendly-name"] === "PolarisKeywordSearchExplorePageRelayPaginationQuery")
      ?? mediaReqs[mediaReqs.length - 1];
    console.log("using template:", template.headers["x-fb-friendly-name"]);
    console.log("template:", template.url, "| friendly:", template.headers["x-fb-friendly-name"], "| body head:", template.body?.slice(0, 200));

    const probe = await page.evaluate(async (tpl: ReqInfo) => {
      try {
        // swap/insert "after" inside the variables JSON in the form body
        const params = new URLSearchParams(tpl.body || "");
        let varsRaw = params.get("variables") || "";
        let vars: Record<string, unknown> = {};
        try { vars = JSON.parse(varsRaw); } catch { /* keep */ }
        const firstVarKey = Object.keys(vars).find((k) => !k.startsWith("__") && k !== "data");
        vars.after = null; // first replay: same page sanity check
        vars.first = 12;
        params.set("variables", JSON.stringify(vars));
        const res = await fetch(tpl.url, {
          method: tpl.method,
          credentials: "include",
          headers: {
            ...tpl.headers,
            "content-type": tpl.headers["content-type"] ?? "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });
        const text = await res.text();
        const jsonText = text.startsWith("for (;;);") ? text.slice(9) : text;
        let j: Record<string, unknown> | null = null;
        try { j = JSON.parse(jsonText); } catch { /* html */ }
        const dataObj = (j?.data ?? {}) as Record<string, unknown>;
        // count media nodes + extract next cursor (iterative, no closures)
        let mediaCount = 0;
        let endCursor: string | null = null;
        let hasNext: unknown = null;
        const stack: unknown[] = [dataObj];
        while (stack.length > 0) {
          const cur = stack.pop();
          if (!cur || typeof cur !== "object") continue;
          const o = cur as Record<string, unknown>;
          for (const k of Object.keys(o)) {
            const v = o[k];
            if ((k === "shortcode" || k === "code") && typeof v === "string") mediaCount++;
            if (k === "end_cursor" && typeof v === "string") endCursor = v;
            if (k === "has_next_page") hasNext = v;
            if (v && typeof v === "object") stack.push(v);
          }
        }
        return {
          status: res.status,
          statusField: j?.status ?? null,
          mediaCount,
          endCursor: endCursor ? String(endCursor).slice(0, 30) + "…" : null,
          hasNext,
        };
      } catch (e) {
        return { error: String(e).slice(0, 150) };
      }
    }, template).catch((e) => ({ error: String(e).slice(0, 120) }));
    console.log("REPLAY RESULT:", JSON.stringify(probe));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });

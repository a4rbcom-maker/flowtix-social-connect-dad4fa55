/** Live probe v2: capture the REAL GraphQL payloads behind
 *  facebook.com/pages/?category=your_pages — the page list is NOT in the DOM
 *  (probe v1: only 10 nav anchors), so /list-pages must parse these payloads.
 *  Run: npx tsx src/debug-pages-graphql.ts <sessionId> */
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { supabaseService } from "./services/supabase.js";
import type { Response } from "playwright";

interface Hit {
  url: string;
  docId: string;
  bodySample: string;
  nameHits: string[];
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) throw new Error("usage: debug-pages-graphql <sessionId>");
  await browserPool.init();
  const { cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, undefined, userAgent, storageState);

  const hits: Hit[] = [];
  const onResp = async (resp: Response) => {
    try {
      const url = resp.url();
      if (!url.includes("graphql")) return;
      if (resp.status() !== 200) return;
      const req = resp.request();
      const postData = req.postData() || "";
      const docId = postData.match(/doc_id[=:](\d+)/)?.[1] || "?";
      const text = await resp.text();
      if (!text || text.length < 100) return;
      // Look for page-like entities: id + name + page-ish markers
      const nameHits: string[] = [];
      const re = /"id"\s*:\s*"(\d{10,})"\s*,\s*"name"\s*:\s*"([^"]{2,80})"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null && nameHits.length < 10) nameHits.push(`${m[1]} => ${m[2]}`);
      const interesting = nameHits.length > 0 || text.includes("pages_you_manage") || text.includes("follower_count");
      if (!interesting) return;
      hits.push({ url: url.substring(0, 100), docId, nameHits, bodySample: text.substring(0, 300) });
    } catch { /* body consumed */ }
  };
  page.on("response", onResp);

  try {
    await page.goto("https://www.facebook.com/pages/?category=your_pages", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(8000);
    // nudge scroll in case the list lazy-loads
    await page.mouse.wheel(0, 1200).catch(() => {});
    await page.waitForTimeout(5000);

    console.log(JSON.stringify({ totalHits: hits.length }, null, 1));
    for (const h of hits) {
      console.log(JSON.stringify({ docId: h.docId, url: h.url, nameHits: h.nameHits, sample: h.bodySample.substring(0, 200).replace(/\n/g, " ") }, null, 1));
    }
    page.off("response", onResp);
  } finally {
    await contextManager.releaseContext(contextId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAILED:", String(e).substring(0, 300)); process.exit(1); });

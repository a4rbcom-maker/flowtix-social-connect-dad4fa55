
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
async function main() {
  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies("505cc920-2c26-4a00-a9b8-c85030826de2");
  const { page, contextId } = await igContextManager.createContext("505cc920-2c26-4a00-a9b8-c85030826de2", cookies, undefined, userAgent);
  try {
    await page.goto("https://www.instagram.com/tourismegypt/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const r = await page.evaluate(async () => {
      const html = await fetch("https://www.instagram.com/tourismegypt/", { credentials: "include" }).then((res) => res.text());
      const out: Record<string, unknown> = { len: String(html.length) };
      out.friendships = (html.match(/friendships\/(\d+)\//) || [])[1] || null;
      out.mediaId = (html.match(/"id":"(\d+)_(\d+)"/) || [])[2] || null;
      out.pkOwner = (html.match(/"pk":"(\d+)"/) || [])[1] || null;
      out.metaOg = (html.match(/content="instagram:\/\/(\w+)\/?/) || [])[1] || null;
      // context windows around the target username
      const idx = html.indexOf('"tourismegypt"');
      if (idx > 0) out.ctx1 = html.slice(Math.max(0, idx - 100), idx + 40).replace(/\s+/g, " ");
      const idx2 = html.indexOf("tourismegypt", idx + 1000);
      if (idx2 > 0) out.ctx2 = html.slice(Math.max(0, idx2 - 100), idx2 + 40).replace(/\s+/g, " ");
      out.pLinks = (html.match(/instagram\.com\/(?:p|reel)\//g) || []).length;
      out.shortcodeSample = html.match(/(?:p|reel)\/([A-Za-z0-9_-]{8,})/) ? (html.match(/(?:p|reel)\/([A-Za-z0-9_-]{8,})/) as string[])[1] : null;
      out.hasXdt = html.includes("xdt_api__v1__feed__user_timeline");
      out.timelineId = (html.match(/"id":"(\d+)_(\d+)"/) || [])[0] || null;
      return out;
    });
    console.log("RESOLVE:", JSON.stringify(r));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

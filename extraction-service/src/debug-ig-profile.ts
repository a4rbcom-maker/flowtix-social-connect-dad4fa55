/** Dump profile header shapes for ig_profile_info debugging. */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";

async function main() {
  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(process.argv[2]);
  const { page, contextId } = await igContextManager.createContext(process.argv[2], cookies, undefined, userAgent);
  try {
    await page.goto("https://www.instagram.com/tourismegypt/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => {
      const counters = Array.from(document.querySelectorAll("a, button, span"))
        .map((el) => (el.textContent || "").trim())
        .filter((t) => t && t.length <= 40 && /\d/.test(t) && /(posts?|followers?|following)/i.test(t))
        .slice(0, 8);
      return {
        url: location.href,
        hasHeader: !!document.querySelector("header"),
        hasMain: !!document.querySelector("main"),
        h1: document.querySelector("h1")?.textContent?.slice(0, 60) ?? null,
        h2: Array.from(document.querySelectorAll("h2")).map((h) => h.textContent?.slice(0, 40)).slice(0, 3),
        ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
        ogDesc: document.querySelector('meta[property="og:description"]')?.getAttribute("content")?.slice(0, 200) ?? null,
        counters,
      };
    });
    console.log(JSON.stringify(r, null, 1));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });

/** Deep-scan the video surface for ANY reaction entry point (text/number/button).
 * Run: PROBE_SESSION=ba5882ba POST_URL="https://www.facebook.com/share/v/181P26uqP8/" npx tsx src/debug-fb-m-video2.ts
 */
import { chromium } from "playwright";
import fs from "fs";
const SESSION = process.env.PROBE_SESSION || "ba5882ba-dfd5-42a1-900c-dc3fff77fcb7";
const POST_URL = process.env.POST_URL || "https://www.facebook.com/share/v/181P26uqP8/";
const envText = fs.readFileSync(".env", "utf8").replace(/\r/g, "");
const sbUrl = (envText.match(/^SUPABASE_URL=(.*)$/m) || [])[1]?.trim()!;
const sbKey = (envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m) || [])[1]?.trim()!;
async function main() {
  const r = await fetch(`${sbUrl}/rest/v1/fb_browser_profiles?session_id=eq.${SESSION}&select=cookies_enc,user_agent`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
  const prof = await r.json();
  const raw = JSON.parse(prof[0].cookies_enc);
  const cookies = (Array.isArray(raw) ? raw : JSON.parse(raw)).filter((c: any) => (c.domain || "").includes("facebook") || ["c_user", "xs", "datr"].includes(c.name));
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ userAgent: prof[0].user_agent || undefined });
  await ctx.addCookies(cookies.map((c: any) => { const ss = String(c.sameSite || "").toLowerCase(); return { name: c.name, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/", httpOnly: c.httpOnly ?? false, secure: c.secure ?? true, sameSite: ss === "strict" ? "Strict" : ss === "none" ? "None" : "Lax" }; }));
  const page = await ctx.newPage();
  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);

  const scan = await page.evaluate(`(() => {
    const hits = [];
    // Every visible text node containing reaction-ish keywords OR a number near "تفاعلات"
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; const nums = new Set();
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (!t || t.length > 120) continue;
      if (/تفاعل|reaction|اعجاب|أعجبني|who reacted|متفاعل/i.test(t)) {
        const el = n.parentElement;
        const clickable = el.closest('[role="button"],a,[aria-label],[data-testid]');
        hits.push({ text: t.slice(0,60), clickable: !!clickable, tag: el.tagName, aria: (clickable && clickable.getAttribute("aria-label")||"").slice(0,40) });
      }
      // numbers that could be reaction counts (2-7 digit)
      const m = t.match(/^[\\d.,]\\d{1,6}$/);
      if (m) nums.add(t);
    }
    return { reactionTextHits: hits.slice(0, 12), possibleCountNumbers: [...nums].slice(0,10) };
  })()`).catch(e => ({ error: String(e) }));
  console.log(JSON.stringify(scan, null, 1));
  await browser.close();
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

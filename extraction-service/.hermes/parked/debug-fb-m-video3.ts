/** Click the "All reactions:" entry and verify the reactor dialog opens on video surface.
 * Run: PROBE_SESSION=ba5882ba POST_URL="https://www.facebook.com/share/v/181P26uqP8/" npx tsx src/debug-fb-m-video3.ts
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

  const gqls = [];
  page.on("response", async (resp) => {
    if (!resp.url().includes("/api/graphql/") || resp.status() !== 200) return;
    try {
      const req = resp.request(); const pd = new URLSearchParams(req.postData() || "");
      const body = await resp.text();
      gqls.push({ docId: pd.get("doc_id"), len: body.length, users: (body.match(/"__typename":"User"/g)||[]).length + (body.match(/profile\.php\?id=\d{5,25}/g)||[]).length, isReact: /reactors|reaction_count|feedback_reactions/i.test(body) });
    } catch {}
  });

  await page.goto(POST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  console.log(`landed: ${page.url().slice(0, 90)}`);

  // Click the "All reactions:" / "تفاعلات" clickable text
  const clicked = await page.evaluate(`(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; const targets = [];
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (/^all reactions:|^تفاعلات/i.test(t) || /reactions:/i.test(t)) {
        const el = n.parentElement;
        const clickable = el.closest('[role="button"],a,div[role="button"]') || el;
        targets.push(clickable);
        break;
      }
    }
    if (targets.length) { targets[0].click(); return "clicked-all-reactions"; }
    // fallback: click the number element (308)
    const nums = [];
    const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while ((n = w2.nextNode())) { const t=(n.textContent||"").trim(); if(/^\\d{2,4}$/.test(t)) nums.push(n.parentElement); }
    for (const el of nums) { const c = el.closest('[role="button"],a') || el; c.click(); return "clicked-number"; }
    return "none";
  })()`).catch(e => "err:"+String(e));
  console.log("CLICK:", clicked);
  await page.waitForTimeout(4000);

  const after = await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
    if (!dialog) return { dialogOpen: false };
    const tabs = [...dialog.querySelectorAll('[role="tab"]')].map(t => (t.innerText||"").trim().slice(0,20));
    const profileLinks = [...dialog.querySelectorAll('a[href*="facebook.com"]')].map(a=>a.getAttribute("href").slice(0,60)).slice(0,8);
    return { dialogOpen: true, tabs, profileLinks, nameText: (dialog.innerText||"").slice(0,120) };
  })()`).catch(e => ({ error: String(e) }));
  console.log("AFTER:", JSON.stringify(after, null, 1));
  console.log("\nGRAPHQL fired:", JSON.stringify(gqls.map(g=>`doc=${g.docId} len=${g.len} users=${g.users} react=${g.isReact}`), null, 1));
  await browser.close();
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

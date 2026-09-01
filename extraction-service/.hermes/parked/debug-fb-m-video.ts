/**
 * Probe the ACTUAL surface the service uses (FB_BASE_URL=m.facebook.com) for
 * video /share/v/ reactions — the previous probe wrongly used www.facebook.com.
 * Finds how reactions are rendered/clickable on m.* , and whether the
 * reactions dialog opens / a GraphQL reactor request fires.
 *
 * Run: PROBE_SESSION=ba5882ba POST_URL="https://www.facebook.com/share/v/181P26uqP8/" npx tsx src/debug-fb-m-video.ts
 */
import { chromium } from "playwright";
import fs from "fs";
const SESSION = process.env.PROBE_SESSION || "ba5882ba-dfd5-42a1-900c-dc3fff77fcb7";
const POST_URL = process.env.POST_URL || "https://www.facebook.com/share/v/181P26uqP8/";
const envText = fs.readFileSync(".env", "utf8").replace(/\r/g, "");
const sbUrl = (envText.match(/^SUPABASE_URL=(.*)$/m) || [])[1]?.trim()!;
const sbKey = (envText.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m) || [])[1]?.trim()!;

interface Gql { docId: string | null; len: number; users: number; ctx: string; hasNext: boolean; }

async function main() {
  const r = await fetch(`${sbUrl}/rest/v1/fb_browser_profiles?session_id=eq.${SESSION}&select=cookies_enc,user_agent`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
  const prof = await r.json();
  if (!Array.isArray(prof) || !prof[0]) throw new Error("no profile " + SESSION);
  const raw = JSON.parse(prof[0].cookies_enc);
  const cookies = (Array.isArray(raw) ? raw : JSON.parse(raw)).filter((c: any) => (c.domain || "").includes("facebook") || ["c_user", "xs", "datr"].includes(c.name));
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ userAgent: prof[0].user_agent || undefined });
  await ctx.addCookies(cookies.map((c: any) => { const ss = String(c.sameSite || "").toLowerCase(); return { name: c.name, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/", httpOnly: c.httpOnly ?? false, secure: c.secure ?? true, sameSite: ss === "strict" ? "Strict" : ss === "none" ? "None" : "Lax" }; }));
  const page = await ctx.newPage();

  const gqls: Gql[] = [];
  page.on("response", async (resp) => {
    if ((!resp.url().includes("/api/graphql/") && !resp.url().includes("/graphql/")) || resp.status() !== 200) return;
    try {
      const req = resp.request();
      const pd = new URLSearchParams(req.postData() || "");
      const docId = pd.get("doc_id");
      const body = await resp.text();
      const users = (body.match(/profile\.php\?id=\d{5,25}/g) || []).length + (body.match(/"__typename":"User"/g) || []).length;
      const ctxTag = /reactors|reaction_count/i.test(body) ? "REACT" : /"comments":\{|comment_list|edge_media_to/i.test(body) ? "COMMENT" : "-";
      gqls.push({ docId, len: body.length, users, ctx: ctxTag, hasNext: /"has_next_page":true/.test(body) });
    } catch { /* */ }
  });

  // 1) Load the m.facebook.com permalink (what the service navigates to).
  const base = (envText.match(/^FB_BASE_URL=(.*)$/m) || [])[1]?.trim() || "https://m.facebook.com";
  console.log(`base=${base} post=${POST_URL}`);
  await page.goto(`${base}/share/v/181P26uqP8/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  console.log(`landed: ${page.url().slice(0, 110)}`);

  // 2) Scan for reaction controls on the m.* surface.
  const scan1 = await page.evaluate(`(() => {
    const out = { hrefReaction: 0, ariaReaction: 0, ariaNumber: 0, fbProfileLinks: 0, sampleAria: [] };
    document.querySelectorAll('a[href]').forEach(a => { const h=a.getAttribute("href")||""; if(h.includes("/ufi/reaction/")||h.includes("reaction")) { out.hrefReaction++; if(out.sampleAria.length<8) out.sampleAria.push("A:"+h.slice(0,60)); } });
    document.querySelectorAll('[aria-label]').forEach(el => { const a=(el.getAttribute("aria-label")||"").trim(); const l=a.toLowerCase(); if(l.includes("reaction")||l.includes("تفاعل")||l.includes("interaction")) { out.ariaReaction++; if(out.sampleAria.length<8) out.sampleAria.push("ARIA:"+a.slice(0,60)); } else if(/^[\\d,.]/.test(a)) { out.ariaNumber++; } });
    document.querySelectorAll('a[href*="profile.php"], a[href*="/user/"], a[href*="facebook.com/"]').forEach(a=>{ if((a.getAttribute("href")||"").includes("facebook.com")) out.fbProfileLinks++; });
    return out;
  })()`).catch(e => ({ error: String(e) }));
  console.log("SCAN (before click):", JSON.stringify(scan1, null, 1));

  // 3) Try clicking the most likely reaction-count / like controls.
  const clickResult = await page.evaluate(`(() => {
    // 3a. aria-label containing reaction/تفاعل
    for (const el of document.querySelectorAll('[aria-label]')) {
      const a=(el.getAttribute("aria-label")||"").trim().toLowerCase();
      if(a.includes("reaction")||a.includes("تفاعل")||a.includes("interaction")) { el.click(); return "aria-reaction"; }
    }
    // 3b. text like "أعجبني" / "Like" buttons
    for (const el of document.querySelectorAll('[role="button"]')) {
      const t=(el.innerText||"").trim().toLowerCase();
      if(t==="أعجبني"||t==="like"||t.includes("تفاعل")||t.includes("reaction")) { el.click(); return "role-btn-"+t.slice(0,20); }
    }
    // 3c. any element whose innerText is a bare reaction count number
    for (const el of document.querySelectorAll('span,div')) {
      const t=(el.innerText||"").trim();
      if(/^\\d{1,3}([.,]\\d+)?$/.test(t) && parseInt(t.replace(/[,.]/g,""))>3 && el.children.length===0) { el.click(); return "number-"+t; }
    }
    return "none";
  })()`).catch(e => "err:"+String(e));
  console.log("CLICK:", clickResult);
  await page.waitForTimeout(4000);

  // 4) Did a dialog open? and re-scan for reactor links inside it.
  const after = await page.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
    let inDialog = { count: 0, sample: [] };
    if (dialog) {
      dialog.querySelectorAll('a[href]').forEach(a => { const h=a.getAttribute("href")||""; if(h.includes("facebook.com")) { inDialog.count++; if(inDialog.sample.length<6) inDialog.sample.push(h.slice(0,70)); } });
    }
    // Even without a dialog, scan whole page for profile links (reactor previews).
    const all = new Set();
    document.querySelectorAll('a[href*="profile.php"], a[href*="/user/"], a[href*="facebook.com/"]').forEach(a => { const h=a.getAttribute("href")||""; if(h.includes("facebook.com")&&!h.includes("share/v")&&!h.includes("videos/")) all.add(h.slice(0,70)); });
    return { dialogOpen: !!dialog, inDialog, allPageProfileLinks: all.size, sampleAll: [...all].slice(0,8) };
  })()`).catch(e => ({ error: String(e) }));
  console.log("AFTER:", JSON.stringify(after, null, 1));

  // 5) GraphQL summary.
  console.log("\n=== GRAPHQL (" + gqls.length + ") ===");
  gqls.forEach((g, i) => console.log(`  [#${i}] doc=${g.docId} len=${g.len} users=${g.users} ctx=${g.ctx} hasNext=${g.hasNext}`));

  await browser.close();
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

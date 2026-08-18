import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

async function proof2() {
  const sb = createClient("https://ukjrizflmkutadsrcmut.supabase.co", "sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP");
  const { data: profile } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  const raw = typeof profile!.cookies_enc === "string" ? JSON.parse(profile!.cookies_enc) : profile!.cookies_enc;
  const cookies = (Array.isArray(raw) ? raw : []).map((c: any) => ({ name: c.name, value: String(c.value), domain: c.domain || ".facebook.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" as const }));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // Test 1: mbasic followers URL
  console.log("=== mbasic /followers ===");
  await page.goto("https://mbasic.facebook.com/Hesham.Maged.official/followers", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);
  const m1 = await page.evaluate(() => ({ url: location.href, links: document.querySelectorAll("a").length, text: document.body.innerText.substring(0, 1000) }));
  console.log("URL:", m1.url);
  console.log("Links:", m1.links);
  console.log("Text:", m1.text);

  // Test 2: page ID extraction
  console.log("\n=== page ID extraction ===");
  await page.goto("https://www.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(5000);
  const pageId = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const t = s.textContent || "";
      const m1 = t.match(/"pageID":"(\d{5,20})"/);
      if (m1) return m1[1];
      const m2 = t.match(/"page_id":"(\d{5,20})"/);
      if (m2) return m2[1];
      const m3 = t.match(/"entity_id":"(\d{5,20})"/);
      if (m3) return m3[1];
    }
    return null;
  });
  console.log("Page ID:", pageId);

  // Test 3: GraphQL browse fans URL
  console.log("\n=== browse/mutual_friends or fans ===");
  if (pageId) {
    const urls = [
      `https://www.facebook.com/browse/?type=page_fans&page_id=${pageId}`,
      `https://www.facebook.com/browse/likes?id=${pageId}`,
      `https://www.facebook.com/pages/${pageId}/fans`,
    ];
    for (const u of urls) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        const info = await page.evaluate(() => ({ url: location.href, links: document.querySelectorAll("a").length, text: document.body.innerText.substring(0, 300) }));
        console.log(`URL: ${u}`);
        console.log(`  → ${info.url}, links=${info.links}, text=${info.text.substring(0, 200)}`);
      } catch (err) {
        console.log(`URL failed: ${u} — ${String(err).substring(0, 80)}`);
      }
    }
  }

  await browser.close();
}
proof2().catch(e => console.error(String(e).substring(0, 500)));

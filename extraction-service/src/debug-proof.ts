import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

async function proof() {
  const sb = createClient("https://ukjrizflmkutadsrcmut.supabase.co", "sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP");
  const { data: profile } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  const raw = typeof profile!.cookies_enc === "string" ? JSON.parse(profile!.cookies_enc) : profile!.cookies_enc;
  const cookies = (Array.isArray(raw) ? raw : []).map((c: any) => ({ name: c.name, value: String(c.value), domain: c.domain || ".facebook.com", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" as const }));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  console.log("=== TEST: As ADMIN, can we access Settings? ===");
  await page.goto("https://www.facebook.com/Hesham.Maged.official/settings/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log("Settings URL:", page.url());
  const settingsText = await page.evaluate(() => document.body.innerText.substring(0, 800));
  console.log("Settings content:", settingsText.substring(0, 500));

  console.log("\n=== TEST: Community tab ===");
  await page.goto("https://www.facebook.com/Hesham.Maged.official/community/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  const comm = await page.evaluate(() => ({
    url: location.href,
    listItems: document.querySelectorAll("[role=listitem], [role=article]").length,
    text: document.body.innerText.substring(0, 500),
  }));
  console.log("Community URL:", comm.url);
  console.log("Community listItems:", comm.listItems);
  console.log("Community text:", comm.text.substring(0, 400));

  console.log("\n=== TEST: mbasic.facebook.com (basic HTML) ===");
  await page.goto("https://mbasic.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const mbasic = await page.evaluate(() => ({
    url: location.href,
    links: document.querySelectorAll("a").length,
    text: document.body.innerText.substring(0, 500),
  }));
  console.log("mbasic URL:", mbasic.url);
  console.log("mbasic links count:", mbasic.links);
  console.log("mbasic text:", mbasic.text.substring(0, 400));

  await browser.close();
}
proof().catch(e => console.error(String(e).substring(0, 500)));

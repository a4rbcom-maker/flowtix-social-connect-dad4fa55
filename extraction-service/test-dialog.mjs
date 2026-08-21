import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await sb.from("fb_browser_profiles").select("cookies_enc, user_agent").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
const cookies = JSON.parse(data.cookies_enc).map((c: any) => ({ name: c.name, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/" }));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36" });
await ctx.addCookies(cookies);
const page = await ctx.newPage();

const url = "https://www.facebook.com/ufi/reaction/profile/browser/?ft_ent_identifier=pfbid02h3wpErhJmHjBCjKtAyUqCrte7A2jaLDWxX6ZhMXPib3Zi36G";
console.log("Navigating to:", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(3000);

const finalUrl = page.url();
console.log("Final URL:", finalUrl);

const hasDialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
console.log("Has dialog:", hasDialog);

const profileLinks = await page.evaluate(() => {
  const links = document.querySelectorAll('a[href*="profile.php?id="]');
  return { count: links.length, samples: Array.from(links).slice(0, 5).map(a => ({ href: a.getAttribute("href"), text: a.textContent?.trim()?.substring(0, 30) })) };
});
console.log("Profile links:", JSON.stringify(profileLinks, null, 2));

const allLinks = await page.evaluate(() => document.querySelectorAll("a").length);
console.log("Total <a> tags:", allLinks);

const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
console.log("Body text preview:", bodyText);

await browser.close();

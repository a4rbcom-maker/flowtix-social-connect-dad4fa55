import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { extractDomUsers } from "./services/dom-extractor.js";

async function test() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profile } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  const raw = typeof profile!.cookies_enc === "string" ? JSON.parse(profile!.cookies_enc) : profile!.cookies_enc;
  const cookies = (Array.isArray(raw) ? raw : []).map((c: any) => ({
    name: c.name || "", value: String(c.value || ""), domain: c.domain || ".facebook.com",
    path: c.path || "/", expires: -1, httpOnly: false, secure: true,
    sameSite: ["Strict","Lax","None"].includes(c.sameSite) ? c.sameSite : "Lax",
  }));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", viewport: { width: 1366, height: 768 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  console.log("Testing extractDomUsers...\n");
  
  await page.goto("https://www.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const startTime = Date.now();
  const users = await extractDomUsers(page, "Hesham.Maged.official", { maxRounds: 100, maxUsers: 5000 });
  const duration = (Date.now() - startTime) / 1000;

  console.log(`\n=== RESULTS: ${users.length} users in ${duration}s ===`);
  for (const u of users.slice(0, 30)) {
    console.log(`  ${u.fb_id}: ${u.name}`);
  }

  await browser.close();
}

test().catch(e => console.error(String(e).substring(0, 500)));

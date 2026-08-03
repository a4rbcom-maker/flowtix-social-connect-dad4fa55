import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { ProfileVisitor } from "./services/profile-visitor.js";

async function test() {
  const sb = createClient("https://ukjrizflmkutadsrcmut.supabase.co", "sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP");
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

  // Get seed users from DOM
  const { extractDomUsers } = await import("./services/dom-extractor.js");
  await page.goto("https://www.facebook.com/Hesham.Maged.official/followers/", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(5000);
  await page.goto("https://www.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);
  const seedUsers = await extractDomUsers(page, "Hesham.Maged.official", { maxRounds: 30, maxUsers: 100, scrollMs: 800 });
  console.log(`Seed users: ${seedUsers.length}`);

  // Profile visitor test
  const extracted: any[] = [];
  const visitor = new ProfileVisitor(page, {
    maxProfiles: 20, // test 20 only
    onUserExtracted: async (user) => {
      extracted.push(user);
      console.log(`  got: ${user.name} (${user.fb_id}) [bio=${user.bio} loc=${user.location} work=${user.workplace} f_count=${user.follower_count}]`);
    },
  });

  const start = Date.now();
  const result = await visitor.visitBulk(seedUsers);
  const dur = (Date.now() - start) / 1000;

  console.log(`\n=== VISITED: ${result.visited} users (${result.discovered} discovered, ${result.errors} errors) in ${dur}s ===`);

  await browser.close();
}

test().catch(e => console.error(String(e).substring(0, 500)));

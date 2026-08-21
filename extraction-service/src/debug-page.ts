import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";

async function debug() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await sb
    .from("fb_browser_profiles")
    .select("cookies_enc")
    .eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272")
    .single();

  if (!profile?.cookies_enc) { console.log("No cookies"); await browser.close(); return; }

  const raw = typeof profile.cookies_enc === "string" ? JSON.parse(profile.cookies_enc) : profile.cookies_enc;
  const cookies = (Array.isArray(raw) ? raw : []).map((c: any) => ({
    name: c.name || c.key || "",
    value: String(c.value || ""),
    domain: c.domain || ".facebook.com",
    path: c.path || "/",
    expires: c.expires || c.expirationDate || -1,
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite: (c.sameSite === "Strict" || c.sameSite === "None" || c.sameSite === "Lax") ? c.sameSite : "Lax",
  }));

  console.log(`Loaded ${cookies.length} cookies`);
  console.log(`c_user=${cookies.some(c => c.name === "c_user")}, xs=${cookies.some(c => c.name === "xs")}`);

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "ar-AR",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // ===== TEST 1: /followers/ =====
  console.log("\n=== TEST 1: /followers/ ===");
  const gql: any[] = [];
  page.on("response", async (resp) => {
    if (resp.url().includes("graphql") && resp.status() === 200) {
      try { const t = await resp.text(); gql.push({ len: t.length, preview: t.substring(0, 200) }); } catch {}
    }
  });

  await page.goto("https://www.facebook.com/Hesham.Maged.official/followers/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000);
  console.log(`URL: ${page.url()}`);
  
  if (page.url().includes("login") || page.url().includes("checkpoint")) {
    console.log("â‌Œ SESSION EXPIRED");
    await browser.close(); return;
  }

  const info1 = await page.evaluate(() => ({
    listItems: document.querySelectorAll('[role="listitem"]').length,
    articles: document.querySelectorAll('[role="article"]').length,
    profileLinks: document.querySelectorAll('a[href*="profile.php"], a[href*="facebook.com/"]').length,
    text: document.body.innerText.substring(0, 800),
  }));
  console.log(`listItems=${info1.listItems} articles=${info1.articles} profileLinks=${info1.profileLinks}`);
  console.log(`text: ${info1.text.substring(0, 400)}`);

  // Scroll 10 rounds
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(2000);
  }
  const info2 = await page.evaluate(() => ({
    listItems: document.querySelectorAll('[role="listitem"]').length,
    articles: document.querySelectorAll('[role="article"]').length,
  }));
  console.log(`After scroll: listItems=${info2.listItems} articles=${info2.articles}`);
  console.log(`GraphQL responses: ${gql.length}`);
  for (const r of gql.slice(0, 3)) console.log(`  gql len=${r.len} preview=${r.preview.substring(0, 150)}`);

  // ===== TEST 2: /posts/ =====
  console.log("\n=== TEST 2: /posts/ ===");
  const gql2: any[] = [];
  page.removeAllListeners("response");
  page.on("response", async (resp) => {
    if (resp.url().includes("graphql") && resp.status() === 200) {
      try { const t = await resp.text(); gql2.push({ len: t.length, hasPost: t.includes("creation_time") || t.includes("message") }); } catch {}
    }
  });

  await page.goto("https://www.facebook.com/Hesham.Maged.official/posts/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000);
  console.log(`URL: ${page.url()}`);

  const info3 = await page.evaluate(() => ({
    articles: document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit"]').length,
    timeEls: document.querySelectorAll('abbr[data-utime], time').length,
    text: document.body.innerText.substring(0, 500),
  }));
  console.log(`articles=${info3.articles} timeEls=${info3.timeEls}`);
  console.log(`text: ${info3.text.substring(0, 300)}`);
  console.log(`GraphQL responses: ${gql2.length}, hasPost data: ${gql2.filter(r => r.hasPost).length}`);

  // ===== TEST 3: main page (no /posts/) =====
  console.log("\n=== TEST 3: main page (no /posts/) ===");
  const gql3: any[] = [];
  page.removeAllListeners("response");
  page.on("response", async (resp) => {
    if (resp.url().includes("graphql") && resp.status() === 200) {
      try { const t = await resp.text(); gql3.push({ len: t.length, hasPost: t.includes("creation_time") || t.includes("message") }); } catch {}
    }
  });

  await page.goto("https://www.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000);
  console.log(`URL: ${page.url()}`);

  const info4 = await page.evaluate(() => ({
    articles: document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit"]').length,
    text: document.body.innerText.substring(0, 500),
  }));
  console.log(`articles=${info4.articles}`);
  console.log(`text: ${info4.text.substring(0, 300)}`);
  console.log(`GraphQL responses: ${gql3.length}, hasPost data: ${gql3.filter(r => r.hasPost).length}`);

  // Save HTML
  fs.writeFileSync("C:\\Users\\COMPUC~1\\AppData\\Local\\Temp\\opencode\\debug_followers.html", await page.content());
  console.log("\nHTML saved");

  await browser.close();
}

debug().catch(err => console.error("FATAL:", String(err).substring(0, 500)));

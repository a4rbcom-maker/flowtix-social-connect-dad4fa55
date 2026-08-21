import "dotenv/config";
import { scrapeRecentPosts } from "./services/post-scraper.js";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

async function testPosts() {
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

  console.log("Testing scrapeRecentPosts on Hesham.Maged.official...\n");
  const posts = await scrapeRecentPosts(page, "Hesham.Maged.official", { postLimit: 20 });
  
  console.log(`\n=== RESULTS: ${posts.length} posts ===`);
  for (const p of posts.slice(0, 10)) {
    const date = new Date(p.timestamp * 1000).toISOString().split("T")[0];
    console.log(`  postId=${p.postId} date=${date} reactions=${p.reactionCount} comments=${p.commentCount}`);
    if (p.message) console.log(`    msg: ${p.message.substring(0, 80)}`);
  }

  await browser.close();
}

testPosts().catch(e => console.error(String(e).substring(0, 300)));

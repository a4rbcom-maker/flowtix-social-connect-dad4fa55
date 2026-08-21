import "dotenv/config";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

async function analyze() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profile } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  if (!profile?.cookies_enc) { console.log("No cookies"); return; }
  const raw = typeof profile.cookies_enc === "string" ? JSON.parse(profile.cookies_enc) : profile.cookies_enc;
  const cookies = (Array.isArray(raw) ? raw : []).map((c: any) => ({
    name: c.name || c.key || "", value: String(c.value || ""), domain: c.domain || ".facebook.com",
    path: c.path || "/", expires: c.expires || c.expirationDate || -1, httpOnly: !!c.httpOnly,
    secure: c.secure !== false, sameSite: (c.sameSite === "Strict" || c.sameSite === "None") ? c.sameSite : "Lax",
  }));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", viewport: { width: 1366, height: 768 } });
  await context.addCookies(cookies);
  const page = await context.newPage();

  const gqlResponses: string[] = [];
  page.on("response", async (resp) => {
    if (resp.url().includes("graphql") && resp.status() === 200) {
      try { const t = await resp.text(); if (t.length > 5000) gqlResponses.push(t); } catch {}
    }
  });

  // Go to main page and scroll to load posts
  await page.goto("https://www.facebook.com/Hesham.Maged.official", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await page.waitForTimeout(2000); }

  console.log("Large GraphQL responses: " + gqlResponses.length);

  // Save ONLY the first response (has creation_time, message, reaction)
  if (gqlResponses.length > 0) {
    const resp = gqlResponses[0];
    try {
      let jsonText = resp;
      const forIdx = resp.indexOf("for (;;);");
      if (forIdx >= 0) jsonText = resp.substring(forIdx + 9).trim();
      const data = JSON.parse(jsonText);

      const hasCreationTime = resp.includes("creation_time");
      const hasMessage = resp.includes("message");
      const hasPostId = resp.includes("post_id");
      const hasFeedback = resp.includes("feedback");
      const hasReaction = resp.includes("reaction");
      console.log(`has creation_time=${hasCreationTime} message=${hasMessage} post_id=${hasPostId} feedback=${hasFeedback} reaction=${hasReaction}`);

      // Find user IDs in the response
      const userIdMatches = resp.match(/"id"\s*:\s*["'](\d{10,})["']/g) || [];
      console.log(`user id matches: ${userIdMatches.length}`);

      // Save full response
      fs.writeFileSync("C:\\Users\\COMPUC~1\\AppData\\Local\\Temp\\opencode\\gql_full.json", JSON.stringify(data));
      console.log("Saved FULL response to gql_full.json (size=" + JSON.stringify(data).length + ")");
    } catch (err) { console.log("Parse error: " + String(err).substring(0, 100)); }
  }

  await browser.close();
}

analyze().catch(e => console.error(String(e).substring(0, 300)));

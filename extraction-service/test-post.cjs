const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

(async () => {
  const sb = createClient("https://ukjrizflmkutadsrcmut.supabase.co", "sb_secret_rptw3rPZ4xpbfYavBA5snA_KFXa9MdP", { auth: { persistSession: false } });
  const { data } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  const cookies = JSON.parse(data.cookies_enc).map(c => ({ name: c.name, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/" }));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // Try permalink approach - open the post itself
  const postUrl = "https://www.facebook.com/MarwaHssanofficial/posts/pfbid02h3wpErhJmHjBCjKtAyUqCrte7A2jaLDWxX6ZhMXPib3Zi36G";
  console.log("Opening post:", postUrl);
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);
  console.log("Final URL:", page.url());

  // Check page content
  const bodyText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500));
  console.log("Body preview:", bodyText);

  // Find reaction-related elements
  const reactions = await page.evaluate(() => {
    const all = document.querySelectorAll("[aria-label]");
    const matches = [];
    for (const el of all) {
      const label = el.getAttribute("aria-label") || "";
      if (label.match(/\d/) && (label.toLowerCase().includes("reaction") || label.toLowerCase().includes("like") || label.includes("تفاعل") || label.includes("إعجاب") || label.includes("أعجب"))) {
        matches.push({ label, tag: el.tagName, text: (el.textContent || "").trim().substring(0, 50) });
      }
    }
    return matches.slice(0, 10);
  });
  console.log("Reaction elements:", JSON.stringify(reactions, null, 2));

  // Try clicking the first reaction element
  if (reactions.length > 0) {
    console.log("\nClicking first reaction element...");
    await page.evaluate(() => {
      const all = document.querySelectorAll("[aria-label]");
      for (const el of all) {
        const label = el.getAttribute("aria-label") || "";
        if (label.match(/\d/) && (label.toLowerCase().includes("reaction") || label.includes("تفاعل") || label.includes("إعجاب") || label.includes("أعجب"))) {
          el.click();
          return;
        }
      }
    });
    await page.waitForTimeout(2000);

    const hasDialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    console.log("Dialog opened:", hasDialog);

    if (hasDialog) {
      const profileLinks = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { count: 0 };
        const links = dialog.querySelectorAll('a[href*="profile.php?id="]');
        return {
          count: links.length,
          samples: Array.from(links).slice(0, 5).map(a => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().substring(0, 30) }))
        };
      });
      console.log("Profile links in dialog:", JSON.stringify(profileLinks, null, 2));
    }
  }

  await browser.close();
})();

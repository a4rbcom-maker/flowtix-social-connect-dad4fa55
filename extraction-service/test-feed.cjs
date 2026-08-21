require("dotenv").config();
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

(async () => {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await sb.from("fb_browser_profiles").select("cookies_enc").eq("session_id", "7d87c0da-ea16-4b45-91b4-7f1b21b36272").single();
  const cookies = JSON.parse(data.cookies_enc).map(c => ({ name: c.name, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/" }));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  // Open the page feed
  console.log("Opening page feed...");
  await page.goto("https://www.facebook.com/MarwaHssanofficial", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);

  // Scroll down a bit to load posts
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(2000);

  // Find articles and look for reaction counts
  const reactionInfo = await page.evaluate(() => {
    const articles = document.querySelectorAll('[role="article"], div[data-pagelet^="FeedUnit_"]');
    const results = [];
    for (let i = 0; i < Math.min(articles.length, 5); i++) {
      const article = articles[i];
      const ariaLabels = [];
      const labeled = article.querySelectorAll("[aria-label]");
      for (const el of labeled) {
        const label = el.getAttribute("aria-label") || "";
        if (label.match(/\d/) && (label.toLowerCase().includes("reaction") || label.toLowerCase().includes("like") || label.includes("طھظپط§ط¹ظ„") || label.includes("ط¥ط¹ط¬ط§ط¨") || label.includes("ط£ط¹ط¬ط¨") || label.includes("طھط¹ظ„ظٹظ‚") || label.includes("comment"))) {
          ariaLabels.push(label.substring(0, 80));
        }
      }
      // Also check for any links with profile IDs
      const profileLinks = article.querySelectorAll('a[href*="profile.php?id="]');
      results.push({ index: i, ariaLabels, profileLinks: profileLinks.length });
    }
    return results;
  });
  console.log("Articles with reactions:", JSON.stringify(reactionInfo, null, 2));

  // Try to click on the reactions of the first article
  if (reactionInfo.length > 0 && reactionInfo[0].ariaLabels.length > 0) {
    console.log("\nTrying to click reaction on article 0...");
    const clicked = await page.evaluate(() => {
      const articles = document.querySelectorAll('[role="article"]');
      const article = articles[0];
      if (!article) return "no article";
      const labeled = article.querySelectorAll("[aria-label]");
      for (const el of labeled) {
        const label = el.getAttribute("aria-label") || "";
        if (label.match(/\d/) && (label.toLowerCase().includes("reaction") || label.includes("طھظپط§ط¹ظ„") || label.includes("ط¥ط¹ط¬ط§ط¨"))) {
          el.click();
          return "clicked: " + label.substring(0, 50);
        }
      }
      return "no match";
    });
    console.log("Click result:", clicked);
    await page.waitForTimeout(2000);

    const hasDialog = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    console.log("Dialog opened:", hasDialog);

    if (hasDialog) {
      const dialogLinks = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { count: 0 };
        const links = dialog.querySelectorAll('a[href*="profile.php?id="]');
        return {
          count: links.length,
          samples: Array.from(links).slice(0, 5).map(a => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().substring(0, 30) }))
        };
      });
      console.log("Dialog profile links:", JSON.stringify(dialogLinks, null, 2));
    }
  }

  await browser.close();
})();

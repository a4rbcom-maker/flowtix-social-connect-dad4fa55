import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface DomUser {
  fb_id: string;
  name: string;
  profile_url: string;
}

/**
 * DOM-based user extraction from a Facebook page feed.
 * This collects ALL profile links visible in the DOM after scrolling.
 * Way more reliable than GraphQL parsing.
 */
export async function extractDomUsers(
  page: Page,
  pageIdentifier: string,
  options: { maxRounds?: number; maxUsers?: number; scrollMs?: number } = {}
): Promise<DomUser[]> {
  const maxRounds = options.maxRounds ?? 300;
  const maxUsers = options.maxUsers ?? 50000;
  const scrollMs = options.scrollMs ?? 1500;

  const seen = new Set<string>();
  const users: DomUser[] = [];
  let noNewCount = 0;
  const MAX_NO_NEW = 20; // stop if 20 rounds no new users

  log.info("DomExtract", `DOM extraction: maxRounds=${maxRounds} maxUsers=${maxUsers}`);
  
  // Navigate to the page
  const url = `https://www.facebook.com/${pageIdentifier}`;
  if (!page.url().includes(pageIdentifier)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
  }

  for (let round = 0; round < maxRounds; round++) {
    if (users.length >= maxUsers) break;

    // Collect all profile links from current DOM
    const domUsers = await page.evaluate(() => {
      const results: Array<{ fb_id: string; name: string; profile_url: string }> = [];
      const seenLocal = new Set<string>();
      
      // All anchor elements on the page
      const links = document.querySelectorAll('a[href*="facebook.com"], a[href*="profile.php"], a[href*="/user/"], a[role="link"]');
      
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        if (!href) continue;
        
        // Skip non-profile links
        if (href.includes("/photo") || href.includes("/video") || href.includes("/hashtag") ||
            href.includes("/search") || href.includes("/events") || href.includes("/groups") ||
            href.includes("/share") || href.includes("/plugins") || href.includes("dialog") ||
            href.includes("/notifications") || href.includes("/settings") || href.includes("l.php") ||
            href.includes("/ufi/") || href.includes("/ajax/") || href.includes("/permalink") ||
            href.includes("/story") || href.includes("/reel/") || href.includes("/watch/") ||
            href.includes("php?") && !href.includes("profile.php")) continue;

        // Extract FB ID from URL patterns
        let fbId = "";
        // Pattern 1: /profile.php?id=123456789 (10-25 digit user profile IDs)
        const pmatch = href.match(/id=(\d{10,25})/);
        if (pmatch) fbId = pmatch[1];
        
        // Pattern 2: /username (named profile URLs like /zuck, /john.doe.123)
        const umatch = href.match(/facebook\.com\/([a-zA-Z0-9._-]{3,50})(?:\/|\?|$)/);
        if (!fbId && umatch) {
          const username = umatch[1];
          // Exclude URLs that are page sections, not user profiles
          const sectionWords = /^(photo|video|groups|pages|events|hashtag|share|plugins|dialog|reel|watch|marketplace|gaming|permalink|story|ufi|ajax|notifications|messages|friends|settings|help|policy|privacy|legal|posts|about|followers|photos|videos|community|mentions|reviews|shop|services|live|fundraisers|reels|stories|profile\.php|checkpoint|login|recover|tr|policies|terms|games|ads|business|developers)$/i;
          if (!sectionWords.test(username)) {
            fbId = username;
          }
        }
        
        if (!fbId) continue;

        // Get clean name
        let name = link.getAttribute("aria-label") || "";
        if (!name) {
          // Try to find name in dedicated name spans
          const nameEl = link.querySelector('span[dir="auto"], strong span');
          if (nameEl) name = nameEl.textContent?.trim() || "";
        }
        if (!name) {
          // Check if the link text is short enough to be a name
          const linkText = link.textContent?.trim() || "";
          if (linkText.length >= 2 && linkText.length <= 60 && !linkText.startsWith("http")) {
            name = linkText;
          }
        }
        
        // Quality filters
        if (!name || name.length < 2 || name.length > 60) continue;
        if (name.startsWith("http")) continue;
        if (/^\d+$/.test(name)) continue; // pure numbers
        if (/^(Facebook|Messenger|Instagram|Meta|غير مقروءة|اتصل|مراسلة|متابعة|متابعون|الصور|عرض|تم)/.test(name)) continue;
        // Exclude names that contain notification-like text
        if (name.includes("أرسل إليك") || name.includes("غير مقروءة") || name.includes("طلب صداقة") || name.includes("بلاغ")) continue;
        // Exclude page titles that are clearly not people
        if (name.length > 40 && !/^[A-Za-z\u0600-\u06FF\s._-]+$/.test(name)) continue;

        const profileUrl = href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}`;
        
        const key = fbId;
        if (!seenLocal.has(key)) {
          seenLocal.add(key);
          results.push({ fb_id: fbId, name, profile_url: profileUrl });
        }
      }
      
      return results;
    });

    // Add new users to the main collection
    let newCount = 0;
    for (const u of domUsers) {
      if (!seen.has(u.fb_id)) {
        seen.add(u.fb_id);
        users.push(u);
        newCount++;
      }
    }

    if (newCount > 0) {
      log.info("DomExtract", `round ${round}: +${newCount} users (total=${users.length})`);
      noNewCount = 0;
    } else {
      noNewCount++;
    }

    if (noNewCount >= MAX_NO_NEW) {
      log.info("DomExtract", `round ${round}: no new users for ${MAX_NO_NEW} rounds — stopping`);
      break;
    }

    if (users.length >= maxUsers) {
      log.info("DomExtract", `maxUsers reached (${maxUsers}) — stopping`);
      break;
    }

    // Scroll down
    await page.evaluate(() => window.scrollBy(0, 250 + Math.random() * 400));
    await sleep(scrollMs + Math.random() * 600);

    // Periodically do a bigger scroll
    if (round % 5 === 0) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
      await sleep(2000);
    }
  }

  log.info("DomExtract", `DOM extraction complete: ${users.length} users found`);
  return users;
}

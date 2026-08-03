import type { Page } from "playwright";
import { logger } from "../logger.js";
import type { PagePost } from "./post-scraper.js";

export interface ReactionUser {
  fb_id: string;
  name: string;
  profile_url: string;
  reaction_type?: string;
}

export interface Commenter {
  fb_id: string;
  name: string;
  profile_url: string;
  comment_text?: string;
}

export interface EngagersResult {
  reactors: ReactionUser[];
  commenters: Commenter[];
}

const log = logger;

function buildPostPermalink(post: PagePost): string {
  if (post.permalink && post.permalink.includes("facebook.com") &&
      (post.permalink.includes("/posts/") || post.permalink.includes("permalink.php") ||
       post.permalink.includes("/reel/") || post.permalink.includes("/videos/") ||
       post.permalink.includes("/photo/"))) {
    return post.permalink;
  }
  return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(post.postId)}`;
}

export async function extractEngagersFromPost(
  page: Page,
  post: PagePost,
  options: { maxReactions?: number; maxCommenters?: number; maxScrollSeconds?: number } = {}
): Promise<EngagersResult> {
  const maxReactions = options.maxReactions ?? 2000;
  const maxCommenters = options.maxCommenters ?? 1500;
  const maxScrollSeconds = options.maxScrollSeconds ?? 10;

  const reactorsMap = new Map<string, ReactionUser>();
  const commentersMap = new Map<string, Commenter>();

  try {
    const permalink = buildPostPermalink(post);
    await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 8000 });
    await page.waitForTimeout(1200);
  } catch {
    return { reactors: [], commenters: [] };
  }

  const startTime = Date.now();

  // STEP 1: Quick inline extraction from the post page itself (fast)
  await extractInlineEngagers(page, reactorsMap, commentersMap);

  // STEP 2: Open reactions dialog only if we have time left
  try {
    await extractReactorsViaDialog(page, reactorsMap, maxReactions, maxScrollSeconds, startTime);
  } catch { /* skip */ }

  // STEP 3: Click "view more comments" and extract from DOM
  try {
    await extractCommentersViaDOM(page, commentersMap, maxCommenters, maxScrollSeconds, startTime);
  } catch { /* skip */ }

  const reactors = Array.from(reactorsMap.values());
  const commenters = Array.from(commentersMap.values());
  return { reactors, commenters };
}

// Extract reactors/commenters visible inline on the post page (no dialog needed)
async function extractInlineEngagers(
  page: Page,
  reactorsMap: Map<string, ReactionUser>,
  commentersMap: Map<string, Commenter>,
): Promise<void> {
  const data = await page.evaluate(() => {
    const reactors: { id: string; name: string; url: string }[] = [];
    const commenters: { id: string; name: string; url: string; text?: string }[] = [];
    const rSeen = new Set<string>();
    const cSeen = new Set<string>();

    const extractUser = (href: string, text: string): { id: string; name: string; url: string } | null => {
      let id = "";
      const m1 = href.match(/profile\.php\?id=(\d+)/);
      if (m1) id = m1[1];
      if (!id) {
        const m2 = href.match(/facebook\.com\/([a-zA-Z0-9.]{5,50})(?:[/?]|$)/);
        if (m2) {
          const uname = m2[1].toLowerCase();
          if (!["profile.php", "login", "help", "settings", "photo", "videos", "posts", "reel", "permalink", "story", "watch"].includes(uname)) {
            id = m2[1];
          }
        }
      }
      if (!id || !text || text.length < 2 || text.length > 100) return null;
      const url = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
      return { id, name: text, url };
    };

    // Find reactor links (usually in the reactions bar)
    const reactionBar = document.querySelector('[aria-label*="reaction"], [aria-label*="تفاعل"], [data-visualcompletion]');
    if (reactionBar) {
      const links = reactionBar.querySelectorAll('a[href]');
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const name = (link as HTMLElement).textContent?.trim() || "";
        const u = extractUser(href, name);
        if (u && !rSeen.has(u.id)) { rSeen.add(u.id); reactors.push(u); }
      }
    }

    // Find commenters in visible comments
    const articles = document.querySelectorAll('[role="article"]');
    for (const article of articles) {
      const links = article.querySelectorAll('a[href*="profile.php?id="], a[href*="facebook.com/"]');
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const name = (link as HTMLElement).textContent?.trim() || "";
        const u = extractUser(href, name);
        if (u && !cSeen.has(u.id)) {
          cSeen.add(u.id);
          // Get comment text
          let text = "";
          const parent = link.parentElement?.parentElement;
          if (parent) {
            const textEl = parent.querySelector('[dir="auto"], [data-ad-comet-preview="message"]');
            text = textEl?.textContent?.trim() || "";
          }
          commenters.push({ ...u, text: text.substring(0, 300) });
          break;
        }
      }
    }
    return { reactors, commenters };
  }).catch(() => ({ reactors: [], commenters: [] }));

  for (const u of data.reactors) {
    if (!reactorsMap.has(u.id)) {
      const profileUrl = u.id.match(/^\d+$/) && !u.url.includes("/profile.php")
        ? `https://www.facebook.com/profile.php?id=${u.id}`
        : u.url;
      reactorsMap.set(u.id, { fb_id: u.id, name: u.name.substring(0, 200), profile_url: profileUrl });
    }
  }
  for (const u of data.commenters) {
    if (!commentersMap.has(u.id)) {
      const profileUrl = u.id.match(/^\d+$/) && !u.url.includes("/profile.php")
        ? `https://www.facebook.com/profile.php?id=${u.id}`
        : u.url;
      commentersMap.set(u.id, { fb_id: u.id, name: u.name.substring(0, 200), profile_url: profileUrl, comment_text: u.text });
    }
  }
}

async function extractReactorsViaDialog(
  page: Page,
  reactorsMap: Map<string, ReactionUser>,
  maxReactions: number,
  maxScrollSeconds: number,
  startTime: number,
): Promise<void> {
  // Click the reactions count/link to open dialog
  const clicked = await clickReactionsButton(page);
  if (!clicked) {
    return;
  }

  await page.waitForTimeout(1000);

  // Try clicking "All" tab
  try {
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], [role="menuitemradio"]');
      for (const t of tabs) {
        const text = (t.textContent || "").trim();
        if (text === "All" || text === "الكل" || text.includes("الكل")) {
          (t as HTMLElement).click();
          return;
        }
      }
    });
    await page.waitForTimeout(800);
  } catch { /* skip */ }

  // Scroll dialog and extract users from DOM (tighter loop)
  let noProgress = 0;
  while (reactorsMap.size < maxReactions && Date.now() - startTime < maxScrollSeconds * 1000) {
    const before = reactorsMap.size;
    await extractUsersFromDialogDOM(page, reactorsMap);

    if (reactorsMap.size === before) {
      noProgress++;
      if (noProgress >= 6) break;
    } else {
      noProgress = 0;
    }

    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"] [role="list"]') ||
                  document.querySelector('[role="dialog"] div[style*="overflow"]') ||
                  document.querySelector('[role="dialog"]');
      if (dlg) (dlg as HTMLElement).scrollTop = (dlg as HTMLElement).scrollHeight;
    });
    await page.waitForTimeout(300);
  }

  // Close dialog
  try { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } catch { /* ok */ }
}

async function clickReactionsButton(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    // Strategy 1: aria-label with reaction count
    const candidates = document.querySelectorAll(
      'div[role="button"], span[role="button"], a[role="link"], div[aria-label]'
    );
    for (const el of candidates) {
      const text = (el as HTMLElement).textContent?.trim() || "";
      const aria = (el as HTMLElement).getAttribute("aria-label") || "";
      const lowerAria = aria.toLowerCase();
      const inPost = el.closest('[role="article"], [role="main"], div[data-pagelet]');
      if (!inPost) continue;

      const hasCount = text.match(/^[\d,.KkMم]+$/) || aria.match(/[\d,.KkMم]+/);
      const isReactionLabel =
        lowerAria.includes("reaction") || lowerAria.includes("reactor") ||
        lowerAria.includes("تفاعل") || lowerAria.includes("إعجاب") ||
        lowerAria.includes("أعجب") || lowerAria.includes("like") ||
        lowerAria.includes("love");
      if (hasCount && isReactionLabel) {
        (el as HTMLElement).click();
        return true;
      }
    }

    // Strategy 2: any element whose aria-label contains a reaction keyword + number
    const allLabeled = document.querySelectorAll('[aria-label]');
    for (const el of allLabeled) {
      const aria = (el as HTMLElement).getAttribute("aria-label") || "";
      if (aria.match(/\d/) && (aria.toLowerCase().includes("reaction") || aria.includes("تفاعل") || aria.includes("إعجاب"))) {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          (el as HTMLElement).click();
          return true;
        }
      }
    }

    return false;
  }).catch(() => false);
}

async function extractUsersFromDialogDOM(page: Page, reactorsMap: Map<string, ReactionUser>): Promise<void> {
  const users = await page.evaluate(() => {
    const results: { id: string; name: string; url: string }[] = [];
    const seen = new Set<string>();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return results;

    // Look for profile links inside the dialog
    const links = dialog.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const name = (link as HTMLElement).textContent?.trim() || "";

      let id = "";
      // profile.php?id=NUMBER
      const m1 = href.match(/profile\.php\?id=(\d+)/);
      if (m1) id = m1[1];
      // /username (vanity URL)
      if (!id) {
        const m2 = href.match(/facebook\.com\/([a-zA-Z0-9.]{5,50})(?:[/?]|$)/);
        if (m2) {
          const uname = m2[1];
          if (!["profile.php", "login", "help", "settings", "photo", "videos", "posts", "reel"].includes(uname.toLowerCase())) {
            id = uname;
          }
        }
      }

      if (id && name && name.length >= 2 && name.length <= 100 && !seen.has(id)) {
        seen.add(id);
        const url = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
        results.push({ id, name, url });
      }
    }
    return results;
  }).catch(() => [] as any[]);

  for (const u of users) {
    if (!reactorsMap.has(u.id)) {
      const profileUrl = u.id.match(/^\d+$/) && !u.url.includes("/profile.php")
        ? `https://www.facebook.com/profile.php?id=${u.id}`
        : u.url;
      reactorsMap.set(u.id, {
        fb_id: u.id,
        name: u.name.substring(0, 200),
        profile_url: profileUrl,
      });
    }
  }
}

async function extractCommentersViaDOM(
  page: Page,
  commentersMap: Map<string, Commenter>,
  maxCommenters: number,
  maxScrollSeconds: number,
  startTime: number,
): Promise<void> {
  // Click "view more comments" a few times (faster)
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('[role="button"], a[role="link"], span, div[role="button"]');
      for (const el of els) {
        const t = (el as HTMLElement).textContent?.trim() || "";
        if (t.includes("more comments") || t.includes("عرض") || t.includes("تعليق") ||
            t.includes("comments") || t.match(/^\d+\s*(more|تعليق|رد)/i)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(1000);
  }

  // Scroll for comments (tighter)
  let noProgress = 0;
  while (commentersMap.size < maxCommenters && Date.now() - startTime < maxScrollSeconds * 1000) {
    const before = commentersMap.size;
    await extractCommentersFromDOM(page, commentersMap);

    if (commentersMap.size === before) {
      noProgress++;
      if (noProgress >= 5) break;
    } else {
      noProgress = 0;
    }

    await page.evaluate(() => {
      const containers = [
        document.querySelector('[role="feed"]'),
        document.querySelector('[role="main"]'),
      ];
      const c = containers.find(x => x) as HTMLElement | null;
      if (c) c.scrollTop = c.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(300);
  }
}

async function extractCommentersFromDOM(page: Page, commentersMap: Map<string, Commenter>): Promise<void> {
  const users = await page.evaluate(() => {
    const results: { id: string; name: string; url: string; text?: string }[] = [];
    const seen = new Set<string>();

    // Find all comment containers - look for elements that contain a profile link + comment text
    const articles = document.querySelectorAll('[role="article"]');
    for (const article of articles) {
      // The commenter is the first profile link in the comment
      const profileLinks = article.querySelectorAll('a[href*="profile.php?id="], a[href*="facebook.com/"]');
      for (const link of profileLinks) {
        const href = link.getAttribute("href") || "";
        const name = (link as HTMLElement).textContent?.trim() || "";

        let id = "";
        const m1 = href.match(/profile\.php\?id=(\d+)/);
        if (m1) id = m1[1];
        if (!id) {
          const m2 = href.match(/facebook\.com\/([a-zA-Z0-9.]{5,50})(?:[/?]|$)/);
          if (m2) {
            const uname = m2[1];
            if (!["profile.php", "login", "help", "settings", "photo", "videos", "posts", "reel", "permalink"].includes(uname.toLowerCase())) {
              id = uname;
            }
          }
        }

        if (id && name && name.length >= 2 && name.length <= 100 && !seen.has(id)) {
          // Try to find comment text near this link
          let text = "";
          const parent = link.parentElement?.parentElement;
          if (parent) {
            const textEl = parent.querySelector('[dir="auto"], [role="paragraph"], [data-ad-comet-preview="message"]');
            text = textEl?.textContent?.trim() || "";
          }
          seen.add(id);
          const url = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
          results.push({ id, name, url, text: text.substring(0, 300) });
          break; // Only first profile link per article (the commenter)
        }
      }
    }
    return results;
  }).catch(() => [] as any[]);

  for (const u of users) {
    if (!commentersMap.has(u.id)) {
      const profileUrl = u.id.match(/^\d+$/) && !u.url.includes("/profile.php")
        ? `https://www.facebook.com/profile.php?id=${u.id}`
        : u.url;
      commentersMap.set(u.id, {
        fb_id: u.id,
        name: u.name.substring(0, 200),
        profile_url: profileUrl,
        comment_text: u.text || undefined,
      });
    }
  }
}

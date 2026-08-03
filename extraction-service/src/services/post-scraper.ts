import type { Page } from "playwright";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { detectAuthState } from "../extractors/base.js";

export interface PagePost {
  postId: string;
  permalink: string;
  message: string;
  timestamp: number;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
}

const log = logger;

export async function scrapeRecentPosts(
  page: Page,
  pageIdentifier: string,
  options: { postLimit?: number; maxScrollRounds?: number } = {}
): Promise<PagePost[]> {
  const postLimit = options.postLimit ?? 100;
  const maxScrollRounds = options.maxScrollRounds ?? 60;

  const posts: PagePost[] = [];
  const seenIds = new Set<string>();
  const postsUrl = `https://www.facebook.com/${pageIdentifier}`;

  log.info("PostScraper", `scraping posts from ${postsUrl} (limit=${postLimit})`);

  await page.goto(postsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const html = await page.content();
  const authState = detectAuthState(html, page.url());
  if (authState !== "authenticated") {
    throw new ExtractionError(
      ErrorCodes.SESSION_EXPIRED,
      `PostScraper: auth state = ${authState}`
    );
  }

  // intercept GraphQL responses containing page posts
  const interceptedPosts: PagePost[] = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("graphql") || resp.status() !== 200) return;
    try {
      const text = await resp.text();
      const parsed = parsePostsFromGraphQL(text);
      for (const p of parsed) {
        if (!seenIds.has(p.postId)) {
          seenIds.add(p.postId);
          interceptedPosts.push(p);
        }
      }
    } catch {
      /* skip */
    }
  });

  // also try parsing from current DOM as backup
  const domPosts = await extractPostsFromDOM(page);
  for (const p of domPosts) {
    if (!seenIds.has(p.postId)) {
      seenIds.add(p.postId);
      posts.push(p);
    }
  }

  let noProgressCount = 0;
  for (let round = 0; round < maxScrollRounds && posts.length + interceptedPosts.length < postLimit; round++) {
    if (await page.isClosed?.()) break;
    const beforeCount = interceptedPosts.length + posts.length;

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      const dialog = document.querySelector('[role="feed"], [role="main"]');
      if (dialog instanceof HTMLElement) dialog.scrollTop = dialog.scrollHeight;
    });
    await page.waitForTimeout(800);

    // pick up new intercepted posts
    while (interceptedPosts.length > 0) {
      const p = interceptedPosts.shift()!;
      if (!posts.some(existing => existing.postId === p.postId)) {
        posts.push(p);
      }
    }

    const afterCount = interceptedPosts.length + posts.length;
    if (afterCount === beforeCount) {
      noProgressCount++;
      if (noProgressCount >= 8) break;
    } else {
      noProgressCount = 0;
    }
  }

  // drain remaining
  while (interceptedPosts.length > 0) {
    const p = interceptedPosts.shift()!;
    if (!posts.some(existing => existing.postId === p.postId)) {
      posts.push(p);
    }
  }

  const sorted = posts
    .filter(p => p.postId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, postLimit);

  log.info("PostScraper", `collected ${posts.length} raw posts → ${sorted.length} after sort/dedup`);
  return sorted;
}

function parsePostsFromGraphQL(text: string): PagePost[] {
  const posts: PagePost[] = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();

  try {
    const data = JSON.parse(jsonText);
    walkForPosts(data, posts, 6);
  } catch {
    /* not JSON */
  }
  return posts;
}

function walkForPosts(obj: any, posts: PagePost[], depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForPosts(item, posts, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  // candidate node: has id + creation_time OR id + message text
  // Accept both numeric (old) and alphanumeric (pfbid/new) IDs
  const nodeId = obj.id || obj.post_id || obj.story_key || 
    obj.legacy_story_hideable_id || obj.post_global_id ||
    obj.notification_id || obj.feedback_id || null;

  if (nodeId && /^[a-zA-Z0-9_:-]{8,60}$/.test(String(nodeId))) {
    const timestamp =
      obj.creation_time ||
      obj.creation_timestamp ||
      obj.timestamp ||
      obj.created_time ||
      obj.publish_time ||
      obj.comet_sections?.context_layout?.story?.comet_sections?.metadata?.[0]?.story?.creation_time ||
      null;

    // Try multiple paths for message text
    let message = "";
    if (obj.message) {
      message = typeof obj.message === "string" ? obj.message : (obj.message.text || "");
    }
    if (!message) message = obj.text || "";
    if (!message && obj.story) {
      message = obj.story.message?.text || obj.story.message || "";
    }

    // Try multiple paths for reaction/comment counts
    const reactionCount =
      (obj.feedback && obj.feedback.reaction_count?.count) ??
      obj.reaction_count?.count ??
      obj.reactors?.count ??
      0;

    const commentCount =
      (obj.feedback && obj.feedback.comment_count?.count) ??
      obj.comment_count?.count ??
      obj.comments?.count ??
      0;

    const shareCount =
      (obj.feedback && obj.feedback.share_count?.count) ??
      obj.share_count?.count ??
      obj.shares?.count ??
      0;

    const permalink =
      obj.url ||
      obj.permalink_url ||
      obj.permalink ||
      (obj.attachments?.[0]?.url) ||
      `https://www.facebook.com/${nodeId}`;

    const ts = Number(timestamp) || 0;
    if (ts > 0 || nodeId) {
      posts.push({
        postId: String(nodeId),
        permalink: typeof permalink === "string" && (permalink.startsWith("http") || permalink.startsWith("/"))
          ? (permalink.startsWith("/") ? `https://www.facebook.com${permalink}` : permalink)
          : `https://www.facebook.com/${nodeId}`,
        message: typeof message === "string" ? message.substring(0, 500) : "",
        timestamp: ts || Math.floor(Date.now() / 1000),
        reactionCount: Number(reactionCount) || 0,
        commentCount: Number(commentCount) || 0,
        shareCount: Number(shareCount) || 0,
      });
    }
  }

  // ALSO: check for node-type entries that have creation_time but no proper ID
  // (some GraphQL responses nest data differently)
  if (obj.creation_time && !nodeId) {
    // This might be a nested story — extract what we can
    const ts = Number(obj.creation_time);
    const msg = obj.text || obj.message?.text || "";
    if (ts > 0) {
      // try to find the ancestor ID
      const ancestorId = obj.story_id || obj.legacy_story_hideable_id || obj.post_global_id;
      if (ancestorId) {
        posts.push({
          postId: String(ancestorId),
          permalink: `https://www.facebook.com/${ancestorId}`,
          message: typeof msg === "string" ? msg.substring(0, 500) : "",
          timestamp: ts,
          reactionCount: obj.reaction_count?.count || 0,
          commentCount: obj.comment_count?.count || 0,
          shareCount: obj.share_count?.count || 0,
        });
      }
    }
  }

  // Traverse deeper: edges, nodes, timeline_feed_units, pageItems, etc.
  for (const key of Object.keys(obj)) {
    if (key === "edges" || key === "nodes" || key === "data" || key === "pageItems" ||
        key === "timeline_feed_units" || key === "all_pages" || key === "page_item") {
      walkForPosts(obj[key], posts, depth - 1);
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      // only traverse nested objects, not root-level shallow ones (avoid infinite recursion)
      walkForPosts(obj[key], posts, depth - 1);
    }
  }
}

async function extractPostsFromDOM(page: Page): Promise<PagePost[]> {
  return await page.evaluate(() => {
    const results: any[] = [];
    const articles = document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit"], div[data-pagelet^="FeedUnit_"]');
    articles.forEach((article) => {
      try {
        const permalinkEl = article.querySelector(
          'a[href*="/posts/"], a[href*="permalink.php"], a[href*="/story.php"], ' +
          'a[href*="/reel/"], a[href*="/videos/"], a[href*="/photo/"], ' +
          'a[href*="story_fbid="], a[href*="/watch/?v="]'
        );
        const href = permalinkEl?.getAttribute("href") || "";
        let postId = "";
        const m1 = href.match(/posts\/([a-zA-Z0-9_-]{8,60})/);
        const m2 = href.match(/story_fbid=([a-zA-Z0-9_-]{8,60})/);
        const m3 = href.match(/permalink\.php\?story_fbid=([a-zA-Z0-9_-]{8,60})/);
        const m4 = href.match(/reel\/([a-zA-Z0-9_-]{8,60})/);
        const m5 = href.match(/videos\/([a-zA-Z0-9_-]{8,60})/);
        const m6 = href.match(/photo\/\?fbid=([a-zA-Z0-9_-]{8,60})/);
        const m7 = href.match(/watch\/?\?v=([a-zA-Z0-9_-]{8,60})/);
        if (m1) postId = m1[1];
        else if (m2) postId = m2[1];
        else if (m3) postId = m3[1];
        else if (m4) postId = m4[1];
        else if (m5) postId = m5[1];
        else if (m6) postId = m6[1];
        else if (m7) postId = m7[1];

        const timeEl = article.querySelector('[role="link"] span[id*="timestamp"], abbr[data-utime], time');
        let timestamp = 0;
        const utime = timeEl?.getAttribute("data-utime");
        if (utime) timestamp = Number(utime);
        else if (timeEl instanceof HTMLTimeElement) {
          const ts = timeEl.getAttribute("datetime");
          if (ts) timestamp = Math.floor(new Date(ts).getTime() / 1000);
        }

        const messageEl = article.querySelector('[data-ad-comet-preview="message"], [role="paragraph"], [dir="auto"]');
        const message = messageEl?.textContent?.trim().substring(0, 500) || "";

        if (postId) {
          results.push({
            postId,
            permalink: href.startsWith("http") ? href : `https://www.facebook.com${href}`,
            message,
            timestamp: timestamp || Math.floor(Date.now() / 1000),
            reactionCount: 0,
            commentCount: 0,
            shareCount: 0,
          });
        }
      } catch {
        /* skip */
      }
    });

    // Fallback: also collect ALL post/photo/video links even outside article containers
    if (results.length === 0) {
      const allPostLinks = document.querySelectorAll(
        'a[href*="/posts/"], a[href*="permalink.php"], a[href*="/reel/"], ' +
        'a[href*="/videos/"], a[href*="/photo/"][href*="fbid="]'
      );
      const seen = new Set<string>();
      allPostLinks.forEach((el) => {
        const href = el.getAttribute("href") || "";
        let postId = "";
        const m = href.match(/posts\/([a-zA-Z0-9_-]{8,60})/) || href.match(/story_fbid=([a-zA-Z0-9_-]{8,60})/) ||
                 href.match(/reel\/([a-zA-Z0-9_-]{8,60})/) || href.match(/videos\/([a-zA-Z0-9_-]{8,60})/) ||
                 href.match(/photo\/\?fbid=([a-zA-Z0-9_-]{8,60})/) || href.match(/watch\/?\?v=([a-zA-Z0-9_-]{8,60})/);
        if (m) postId = m[1];
        if (postId && !seen.has(postId)) {
          seen.add(postId);
          results.push({
            postId,
            permalink: href.startsWith("http") ? href : `https://www.facebook.com${href}`,
            message: el.textContent?.trim().substring(0, 500) || "",
            timestamp: Math.floor(Date.now() / 1000),
            reactionCount: 0,
            commentCount: 0,
            shareCount: 0,
          });
        }
      });
    }

    return results;
  }).catch(() => []);
}

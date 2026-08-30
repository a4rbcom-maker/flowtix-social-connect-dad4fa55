/**
 * IG mention probe — verifies the live DOM shape of a post comment box and that
 * a comment actually publishes. MANDATORY before shipping ig-comment-sender.ts
 * (Instagram's DOM changes silently). Run on a REAL connected session:
 *
 *   npx tsx src/debug-ig-comment.ts <igSessionId> <postShortcode> [--via-sender]
 *
 * The --via-sender flag runs the real postComment() from ig-comment-sender.ts
 * against YOUR post and prints { ok } + the selectors confirmed.
 * Without it, this probe only prints the DOM shape + a manual send verdict.
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";
import { postComment } from "./services/ig-comment-sender.js";

async function main() {
  const sessionId = process.argv[2];
  const shortcode = process.argv[3];
  const viaSender = process.argv.includes("--via-sender");
  if (!sessionId || !shortcode) throw new Error("usage: debug-ig-comment <igSessionId> <postShortcode> [--via-sender]");

  await browserPool.init();
  const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, proxy, userAgent);
  try {
    await created.page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    const TEXTBOX = 'article textarea, article [contenteditable="true"][role="textbox"], div[role="dialog"] textarea';
    let found = false;
    for (let i = 0; i < 22 && !found; i++) {
      if (await created.page.$(TEXTBOX)) { found = true; break; }
      await created.page.mouse.move(400 + Math.random() * 200, 500 + Math.random() * 100).catch(() => {});
      await created.page.waitForTimeout(2000);
    }
    const probe = await created.page.evaluate(`(() => {
      const tb = document.querySelector('article textarea, article [contenteditable="true"][role="textbox"]');
      const btns = [...document.querySelectorAll('article button')].map(b => ({ aria: b.getAttribute('aria-label'), txt: (b.innerText||'').trim().slice(0,20) }));
      const postBtn = btns.find(b => /post|نشر|share/i.test(b.aria || '') || /post|نشر/i.test(b.txt || ''));
      return { hasBox: !!tb, boxTag: tb ? tb.tagName : null, boxAria: tb ? tb.getAttribute('aria-label') : null, postBtn };
    })()`);
    console.log("DOM_PROBE:", JSON.stringify(probe));

    if (viaSender) {
      const outcome = await postComment(created.page, shortcode, "FlowTix probe — تجاهل 🙏 @test");
      console.log("SENDER_OUTCOME:", JSON.stringify(outcome));
      console.log(outcome.ok ? "COMMENT_POSTED ✅" : "COMMENT_FAILED ❌");
    } else {
      console.log("comment verdict: run with --via-sender to actually publish on YOUR post");
    }
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });

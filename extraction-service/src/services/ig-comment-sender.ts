/**
 * DOM comment sender for Instagram — posts ONE comment (carrying up to
 * IG_MENTION_CEILING @mentions) on a target post.
 *
 * Same proven contract as message-sender.ts: types Page, no hidden clicks
 * (overlays intercept pointer events → focus + keyboard only), positive
 * delivery confirmation (the comment text must actually appear), and block
 * signals checked BOTH before and after the send. Selectors below are the
 * live-audited baseline from debug-ig-comment.ts (Task 0); if IG changes them,
 * only the constants here move — the flow stays put.
 */
import type { Page } from "playwright";
import { config } from "../config.js";
import { detectIgActionBlock } from "./ig-action-pacing.js";

export type SendOutcome =
  | { ok: true }
  | { ok: false; kind: "rate_limited" | "session_dead" | "thread_unavailable" | "send_failed"; detail: string };

const TEXTBOX =
  'article textarea, article [contenteditable="true"][role="textbox"], div[role="dialog"] textarea';
const POST_BTN =
  'article button[type="button"], div[role="dialog"] button[type="button"]';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** The new comment must surface in the page text to count as delivered. */
async function confirmDelivered(page: Page, textPrefix: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const body = (await page
      .evaluate(`(() => (document.body.innerText || "").replace(/\\s+/g, " "))()`)
      .catch(() => "")) as string;
    if (body.includes(textPrefix)) return true;
    await sleep(600);
  }
  return false;
}

function btnHasText(handle: HTMLElement, want: RegExp): boolean {
  const a = (handle.getAttribute("aria-label") || "").toLowerCase();
  const t = (handle.innerText || "").trim().toLowerCase();
  return want.test(a) || want.test(t);
}

export async function postComment(page: Page, shortcode: string, text: string): Promise<SendOutcome> {
  try {
    await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, {
      waitUntil: "domcontentloaded",
      timeout: config.igNavTimeoutMs,
    });

    // Comment box is lazy-mounted — poll like the message probe did.
    let mounted = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      if (await page.$(TEXTBOX)) {
        mounted = true;
        break;
      }
      await page.mouse.move(400 + Math.random() * 200, 500 + Math.random() * 100).catch(() => {});
      await sleep(2000);
    }
    if (!mounted) return { ok: false, kind: "thread_unavailable", detail: "comment box never mounted (45s)" };

    await sleep(1200 + Math.random() * 1800);

    // Pre-send block check (banners render before the composer is useful).
    const preText = (await page
      .evaluate(`(() => (document.body.innerText || ""))()`)
      .catch(() => "")) as string;
    const pre = detectIgActionBlock(preText);
    if (pre === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall before comment" };
    if (pre === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner before comment" };

    // Human-ish prelude: dismiss overlay traps, then type — no clicks.
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400 + Math.random() * 600);
    await page.focus(TEXTBOX).catch(() => {});
    await sleep(600);
    await page.keyboard.type(text, { delay: 40 + Math.random() * 50 });
    await sleep(800 + Math.random() * 800);

    const prefix = text.replace(/@\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 12) || text.slice(0, 12);
    let posted = await confirmDelivered(page, prefix, 4000);
    if (!posted) {
      // Click the (audited) Post button, then re-confirm.
      await page
        .evaluate(
          `(() => { const btns=[...document.querySelectorAll('${POST_BTN}')]; const b=btns.find(x=>${btnHasText.toString()}); if(b){b.click();return true;} return false; })()`,
        )
        .catch(() => false);
      await sleep(1500);
      posted = await confirmDelivered(page, prefix, 5000);
    }
    if (!posted) {
      const body = (await page
        .evaluate(`(() => (document.body.innerText || ""))()`)
        .catch(() => "")) as string;
      const sig = detectIgActionBlock(body);
      if (sig === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall after comment" };
      if (sig === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner after comment" };
      return { ok: false, kind: "send_failed", detail: "comment not confirmed in page text" };
    }

    // Post-send banner (some only render after the write).
    await sleep(1500 + Math.random() * 1500);
    const postText = (await page
      .evaluate(`(() => (document.body.innerText || ""))()`)
      .catch(() => "")) as string;
    const post = detectIgActionBlock(postText);
    if (post === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall after comment" };
    if (post === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner after comment" };

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind: "send_failed" = /Timeout|net::/.test(msg) ? "send_failed" : "send_failed";
    return { ok: false, kind, detail: msg.slice(0, 200) };
  }
}

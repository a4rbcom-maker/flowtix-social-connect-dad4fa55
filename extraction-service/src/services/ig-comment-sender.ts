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
  | {
      ok: false;
      kind:
        | "rate_limited"
        | "session_dead"
        | "thread_unavailable"
        | "post_unavailable"
        | "send_failed";
      detail: string;
    };

const TEXTBOX =
  'article textarea, article [contenteditable="true"][role="textbox"], div[role="dialog"] textarea';
const POST_BTN =
  'article button[type="button"], div[role="dialog"] button[type="button"]';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The new comment must surface in the page text MORE times than the composer
 * box alone explains. document.body.innerText always includes the typed text
 * inside textarea/contenteditable boxes, so a bare substring match used to
 * report "delivered" for a comment that was never posted. We normalize
 * whitespace and compare occurrence counts: body count > box count means a
 * copy of the comment exists outside the input box (i.e. in the list).
 */
export function isCommentVisibleInPage(bodyText: string, composerBoxTexts: string[], prefix: string): boolean {
  const norm = (s: string): string => (s || "").replace(/\s+/g, " ").trim();
  const want = norm(prefix);
  if (!want) return false;
  const bodyN = norm(bodyText);
  const boxAll = norm((composerBoxTexts ?? []).map((b) => b || "").join(" \u0000 "));
  if (!boxAll) return bodyN.includes(want);
  return bodyN.split(want).length - 1 > boxAll.split(want).length - 1;
}

async function readComposerBoxTexts(page: Page): Promise<string[]> {
  return (await page
    .evaluate(
      `(() => {
        const boxes = document.querySelectorAll('textarea, [contenteditable="true"]');
        return [...boxes].map((b) => (b.innerText || b.value || ""));
      })()`,
    )
    .catch(() => [] as string[])) as string[];
}

/** True only when the POST ITSELF is gone or has comments disabled. */
export function isPostUnavailable(pageText: string): boolean {
  if (!pageText) return false;
  const t = pageText.toLowerCase();
  return /page isn['’]?t available|الصفحة غير متوفرة|page not found|comments are turned off|comments have been limited|تعذّر العثور على الصفحة/.test(
    t,
  );
}

/** The new comment must surface in the page text to count as delivered. */
async function confirmDelivered(page: Page, textPrefix: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const [body, boxes] = await Promise.all([
      page
        .evaluate(`(() => (document.body.innerText || ""))()`)
        .catch(() => "") as Promise<string>,
      readComposerBoxTexts(page),
    ]);
    if (isCommentVisibleInPage(body, boxes, textPrefix)) return true;
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
    if (!mounted) {
      // Distinguish a dead/disabled post (permanent skip) from a slow page
      // (retry): check the page text before giving up on this batch.
      const pageText = (await page
        .evaluate(`(() => (document.body.innerText || ""))()`)
        .catch(() => "")) as string;
      if (isPostUnavailable(pageText)) {
        return { ok: false, kind: "post_unavailable", detail: "post unavailable (404/comments off)" };
      }
      return { ok: false, kind: "thread_unavailable", detail: "comment box never mounted (45s)" };
    }

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

    // Prefix works even when the body is empty (handles-only comment):
    // fall back to the first @handle instead of matching nothing.
    const firstHandle = (text.match(/@[\w.]+/) || [])[0] ?? "";
    const prefix =
      text.replace(/@\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 12) ||
      (firstHandle ? firstHandle.slice(0, 12) : text.slice(0, 12));
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
      if (isPostUnavailable(body)) return { ok: false, kind: "post_unavailable", detail: "post unavailable after comment attempt" };
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

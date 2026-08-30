/**
 * DOM direct-message sender for Instagram — opens a thread to `username` and
 * sends ONE message. Same contract as ig-comment-sender.ts / message-sender.ts.
 *
 * Thread entry: navigate to the profile, click the "Message" affordance, then
 * type into the composer that lazy-mounts in the thread view. Private /
 * non-existent / blocked targets resolve to `thread_unavailable` (skipped, not
 * failed) so they don't burn an account's retry budget. Selectors are the
 * live-audited baseline from debug-ig-dm.ts (Task 0).
 */
import type { Page } from "playwright";
import { config } from "../config.js";
import { detectIgActionBlock } from "./ig-action-pacing.js";

export type SendOutcome =
  | { ok: true }
  | { ok: false; kind: "rate_limited" | "session_dead" | "thread_unavailable" | "send_failed"; detail: string };

const MESSAGE_BTN =
  'header a[href*="/direct/"], header button[type="button"], a[aria-label*="Message" i], a[aria-label*="رسالة" i]';
const TEXTBOX = 'div[contenteditable="true"][role="textbox"], textarea';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

export async function sendIgDm(page: Page, username: string, text: string): Promise<SendOutcome> {
  const handle = username.replace(/^@/, "").replace(/\/+$/, "").trim();
  try {
    // Pre-check on the profile: a private/blocked account is detectable from the
    // profile copy before we even open a thread.
    await page.goto(`${config.igBaseUrl}/${handle}/`, {
      waitUntil: "domcontentloaded",
      timeout: config.igNavTimeoutMs,
    });
    await sleep(2500);
    const profileText = (await page
      .evaluate(`(() => (document.body.innerText || ""))()`)
      .catch(() => "")) as string;
    const preProfile = detectIgActionBlock(profileText);
    if (preProfile === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall on profile" };

    // Open the thread.
    const opened = await page
      .evaluate(
        `(() => { const els=[...document.querySelectorAll('${MESSAGE_BTN}')]; const m=els.find(e=>(e.getAttribute('aria-label')||e.innerText||'').match(/message|رسالة/i)); if(m){m.click();return true;} return false; })()`,
      )
      .catch(() => false);
    if (!opened) {
      // Could not find a Message entry point → account likely private/blocked.
      const sig = detectIgActionBlock(profileText);
      if (sig === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction on profile" };
      return { ok: false, kind: "thread_unavailable", detail: "no Message entry point (private/blocked?)" };
    }

    // Composer is lazy-mounted in the thread view.
    let mounted = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      if (await page.$(TEXTBOX)) {
        mounted = true;
        break;
      }
      await sleep(2000);
    }
    if (!mounted) return { ok: false, kind: "thread_unavailable", detail: "DM composer never mounted (45s)" };

    await sleep(1200 + Math.random() * 1800);

    const preText = (await page
      .evaluate(`(() => (document.body.innerText || ""))()`)
      .catch(() => "")) as string;
    const pre = detectIgActionBlock(preText);
    if (pre === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall before DM" };
    if (pre === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner before DM" };

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400 + Math.random() * 600);
    await page.focus(TEXTBOX).catch(() => {});
    await sleep(600);
    await page.keyboard.type(text, { delay: 40 + Math.random() * 50 });
    await sleep(800 + Math.random() * 800);

    const prefix = text.replace(/\s+/g, " ").slice(0, 15);
    let delivered = await confirmDelivered(page, prefix, 4000);
    if (!delivered) {
      await page.keyboard.press("Enter");
      delivered = await confirmDelivered(page, prefix, 5000);
    }
    if (!delivered) {
      const body = (await page
        .evaluate(`(() => (document.body.innerText || ""))()`)
        .catch(() => "")) as string;
      const sig = detectIgActionBlock(body);
      if (sig === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall after DM" };
      if (sig === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction after DM" };
      return { ok: false, kind: "send_failed", detail: "DM not confirmed in thread" };
    }

    await sleep(1500 + Math.random() * 1500);
    const postText = (await page
      .evaluate(`(() => (document.body.innerText || ""))()`)
      .catch(() => "")) as string;
    const post = detectIgActionBlock(postText);
    if (post === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall after DM" };
    if (post === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction after DM" };

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind: "send_failed" = /Timeout|net::/.test(msg) ? "send_failed" : "send_failed";
    return { ok: false, kind, detail: msg.slice(0, 200) };
  }
}

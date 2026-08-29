/**
 * DOM send layer for Messenger — one thread, one message.
 * Selectors and behavior are proven by the Task 0 live probe (2026-08-29):
 *  - composer: div[contenteditable="true"][role="textbox"] (lazy-mounted ~6s)
 *  - overlays (PIN / E2E banner) intercept pointer events → NEVER click the
 *    composer; focus + keyboard.type() instead
 *  - Enter sends; first Enter occasionally only commits composition → verify
 *    delivery and re-press once
 */
import type { Page } from "playwright";
import { config } from "../config.js";
import { detectBlockSignal } from "./message-pacing.js";

export type SendOutcome =
  | { ok: true }
  | { ok: false; kind: "rate_limited" | "session_dead" | "thread_unavailable" | "send_failed"; detail: string };

const TEXTBOX = 'div[contenteditable="true"][role="textbox"]';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Delivery confirmation: the sent text must appear in the page text
 *  ("You: <prefix>" in the thread list / bubble). Probe-proven signal. */
async function confirmDelivered(page: Page, textPrefix: string, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const body = (await page.evaluate(`(() => (document.body.innerText || "").replace(/\\s+/g, " "))()`).catch(() => "")) as string;
    if (body.includes(textPrefix)) return true;
    await sleep(600);
  }
  return false;
}

/** Send one message into /messages/t/<threadId> on the given page.
 *  Returns an explicit outcome — the worker decides pacing/cooldowns. */
export async function sendOne(page: Page, threadId: string, text: string, _mediaPaths: string[] = []): Promise<SendOutcome> {
  // _mediaPaths: media send is wired in a follow-up pass (probe verified the
  // file input exists but preview-wait selectors still need a live check).
  try {
    await page.goto(`https://www.facebook.com/messages/t/${threadId}`, {
      waitUntil: "domcontentloaded",
      timeout: config.fbNavTimeoutMs,
    });

    // Composer is lazy-mounted — poll like the probe did (~6s typical).
    let composer = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      if (await page.$(TEXTBOX)) { composer = true; break; }
      await page.mouse.move(400 + Math.random() * 200, 500 + Math.random() * 100).catch(() => {});
      await sleep(2000);
    }
    if (!composer) {
      return { ok: false, kind: "thread_unavailable", detail: "composer never mounted (45s)" };
    }
    await sleep(1200 + Math.random() * 1800);

    // Pre-send restriction check (baners render before the thread UI)
    const preText = (await page.evaluate(`(() => (document.body.innerText || ""))()`).catch(() => "")) as string;
    const preSignal = detectBlockSignal(preText);
    if (preSignal === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall before send" };
    if (preSignal === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner before send" };

    // Human-ish prelude: dismiss overlay focus traps, then type — no clicks.
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400 + Math.random() * 600);
    await page.focus(TEXTBOX).catch(() => {});
    await sleep(600);
    await page.keyboard.type(text, { delay: 40 + Math.random() * 50 });
    await sleep(800 + Math.random() * 800);
    await page.keyboard.press("Enter");

    // Delivery confirmation — first Enter sometimes only commits composition.
    const prefix = text.replace(/\s+/g, " ").slice(0, 15);
    let delivered = await confirmDelivered(page, prefix, 4000);
    if (!delivered) {
      await page.keyboard.press("Enter");
      delivered = await confirmDelivered(page, prefix, 5000);
    }
    if (!delivered) {
      // Maybe the text went in but the page copy differs (rtl marks etc.)
      const body = (await page.evaluate(`(() => (document.body.innerText || ""))()`).catch(() => "")) as string;
      if (detectBlockSignal(body)) {
        const signal = detectBlockSignal(body);
        return { ok: false, kind: signal === "session_dead" ? "session_dead" : "rate_limited", detail: "block signal after send attempt" };
      }
      return { ok: false, kind: "send_failed", detail: "delivery not confirmed within window" };
    }

    // Post-send check: some restriction banners only render after the send.
    await sleep(1500 + Math.random() * 1500);
    const postText = (await page.evaluate(`(() => (document.body.innerText || ""))()`).catch(() => "")) as string;
    const postSignal = detectBlockSignal(postText);
    if (postSignal === "session_dead") return { ok: false, kind: "session_dead", detail: "login wall after send" };
    if (postSignal === "rate_limited") return { ok: false, kind: "rate_limited", detail: "restriction banner after send" };

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = msg.includes("Timeout") || msg.includes("net::") ? "send_failed" : "send_failed";
    return { ok: false, kind: kind as "send_failed", detail: msg.slice(0, 200) };
  }
}

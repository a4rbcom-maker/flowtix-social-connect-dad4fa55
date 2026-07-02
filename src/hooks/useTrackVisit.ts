import { useEffect } from "react";

const SESSION_KEY = "flowtix_visit_sid";
const LAST_PATH_KEY = "flowtix_visit_last_path";

function getSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return `anon-${Date.now()}`;
  }
}

/**
 * Fires a single pageview per (session, path) to /api/public/track-visit.
 * Bots are filtered on the server via User-Agent — nothing is logged for crawlers,
 * link-preview bots, or headless browsers.
 */
export function useTrackVisit(path: string) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Skip obvious non-humans on the client too (extra safety before the network call).
      const ua = navigator.userAgent || "";
      if (/bot|crawl|spider|headless|phantom|preview|lighthouse|pagespeed/i.test(ua)) return;
      if ((navigator as any).webdriver) return;

      const sid = getSessionId();
      const key = `${sid}::${path}`;
      const last = sessionStorage.getItem(LAST_PATH_KEY);
      if (last === key) return;
      sessionStorage.setItem(LAST_PATH_KEY, key);

      const payload = JSON.stringify({
        path,
        referrer: document.referrer || null,
        session_id: sid,
        lang: navigator.language || null,
      });

      // Prefer sendBeacon so it survives navigation; fall back to fetch.
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/public/track-visit", blob);
      } else {
        fetch("/api/public/track-visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }, [path]);
}

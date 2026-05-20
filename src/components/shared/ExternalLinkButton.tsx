import { ExternalLink } from "lucide-react";
import { type ReactNode, type MouseEvent } from "react";
import { toast } from "sonner";

/**
 * Unified handler for any external link in the app (Facebook, WhatsApp, Meta
 * Business, Graph Explorer, etc.).
 *
 * Behaviour — guaranteed in this exact order:
 *   1) ALWAYS copy the URL to the clipboard first.
 *   2) Try opening via a synthetic <a target="_blank"> click (most reliable
 *      inside the Lovable preview iframe).
 *   3) Fall back to window.open.
 *   4) Fall back to top-frame navigation.
 *   5) If nothing works, surface a clipboard-only toast so the user can paste.
 *
 * Optional `onDebug` lets the host page tap into each step for a debug log.
 */
export type ExternalLinkDebugLevel = "info" | "success" | "warn" | "error";
export type ExternalLinkDebug = (
  level: ExternalLinkDebugLevel,
  step: string,
  detail?: string,
) => void;

export async function openExternalUrl(
  url: string,
  opts: {
    lang?: "ar" | "en";
    onDebug?: ExternalLinkDebug;
    silent?: boolean;
  } = {},
): Promise<{ copied: boolean; opened: boolean; method: string | null }> {
  const { lang = "ar", onDebug, silent = false } = opts;
  const log: ExternalLinkDebug = (l, s, d) => onDebug?.(l, s, d);

  // Unified, parallel AR/EN messages — one source of truth.
  const M = {
    openedAndCopied: {
      ar: "تم فتح الرابط ونسخه احتياطياً إلى الحافظة.",
      en: "Link opened and copied to clipboard as a backup.",
    },
    openedOnly: {
      ar: "تم فتح الرابط في تبويب جديد.",
      en: "Link opened in a new tab.",
    },
    copiedOnly: {
      ar: "تعذّر فتح الرابط هنا، لكنه نُسخ إلى الحافظة — الصقه في تبويب جديد.",
      en: "Couldn't open here, but the link was copied — paste it in a new tab.",
    },
    failed: {
      ar: "تعذّر فتح الرابط ولم يتم نسخه. افتحه يدوياً.",
      en: "Couldn't open the link and copy failed. Open it manually.",
    },
  } as const;
  const msg = (k: keyof typeof M) => M[k][lang];

  log("info", "openExternalUrl:start", `url=${url}`);

  try {
    const inIframe = window.self !== window.top;
    const sandbox = (window.frameElement as HTMLIFrameElement | null)
      ?.getAttribute?.("sandbox") ?? null;
    log(
      "info",
      "openExternalUrl:env",
      `inIframe=${inIframe} sandbox=${sandbox ?? "n/a"} clipboard=${!!navigator.clipboard}`,
    );
  } catch (e) {
    log("warn", "openExternalUrl:env", e instanceof Error ? e.message : String(e));
  }

  // CRITICAL: open the tab SYNCHRONOUSLY first while we still have the user
  // gesture. Awaiting clipboard.writeText() before this breaks the gesture
  // chain and the browser blocks the popup.
  let opened = false;
  let method: string | null = null;
  let popupWindow: Window | null = null;

  // 1) Try window.open first — only reliable way to detect popup blockers.
  try {
    popupWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (popupWindow) {
      opened = true;
      method = "window.open";
      log("success", "window.open", "got window");
    } else {
      log("warn", "window.open", "returned null (popup blocked)");
    }
  } catch (e) {
    log("error", "window.open", e instanceof Error ? e.message : String(e));
  }

  // 2) Fallback: synthetic anchor click (for sandboxed iframes).
  if (!opened) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener,noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      opened = true;
      method = "anchor";
      log("success", "anchor.click", "dispatched");
    } catch (e) {
      log("warn", "anchor.click", e instanceof Error ? e.message : String(e));
    }
  }

  // 3) NOW copy to clipboard (async is fine — gesture already used).
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
    log("success", "clipboard.writeText", "ok");
  } catch (e) {
    log("error", "clipboard.writeText", e instanceof Error ? e.message : String(e));
  }

  const notifyOpened = (m: string) => {
    if (silent) return;
    const text = copied ? msg("openedAndCopied") : msg("openedOnly");
    toast.success(text, {
      description: copied
        ? undefined
        : lang === "ar"
          ? "إذا لم يظهر التبويب، تحقق من حاجب النوافذ."
          : "If the tab didn't appear, check your popup blocker.",
      duration: 4500,
    });
    log("info", "toast", `opened via ${m} (copied=${copied})`);
  };

  if (opened && method) {
    notifyOpened(method);
    return { copied, opened: true, method };
  }

  // 4) Top-frame navigation.
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url;
      log("success", "top.location", "navigated");
      notifyOpened("top.location");
      return { copied, opened: true, method: "top" };
    }
    log("info", "top.location", "skipped (not in iframe)");
  } catch (e) {
    log("error", "top.location", e instanceof Error ? e.message : String(e));
  }

  // 5) Nothing worked — show a persistent, actionable toast with an inline
  //    "Open" anchor. Toast actions trigger DIRECTLY from a user gesture,
  //    which often bypasses popup blockers that killed the earlier attempts.
  if (!silent) {
    const openLabel = lang === "ar" ? "فتح الرابط" : "Open link";
    const text = copied ? msg("copiedOnly") : msg("failed");
    const fn = copied ? toast.warning : toast.error;
    fn(text, {
      description: url,
      duration: 12000,
      action: {
        label: openLabel,
        onClick: () => {
          // Direct user-gesture open — most reliable last resort.
          try {
            window.open(url, "_blank", "noopener,noreferrer");
          } catch {
            if (window.top && window.top !== window.self) {
              window.top.location.href = url;
            }
          }
        },
      },
    });
  }
  log(copied ? "warn" : "error", "openExternalUrl:end", `copied=${copied} opened=false`);
  return { copied, opened: false, method: null };
}

interface Props {
  url: string;
  children: ReactNode;
  className?: string;
  lang?: "ar" | "en";
  onDebug?: ExternalLinkDebug;
  showIcon?: boolean;
  /** Render as <a> or <button>. Default <a> for proper hover/right-click UX. */
  as?: "a" | "button";
}

/**
 * Drop-in replacement for any external <a target="_blank">. Always copies
 * the URL to the clipboard before attempting to open, and uses the most
 * reliable opening strategy for the current environment (incl. iframes).
 */
export function ExternalLinkButton({
  url,
  children,
  className,
  lang = "ar",
  onDebug,
  showIcon = true,
  as = "a",
}: Props) {
  const handle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void openExternalUrl(url, { lang, onDebug });
  };

  const content = (
    <>
      {children}
      {showIcon && <ExternalLink className="h-3.5 w-3.5" />}
    </>
  );

  if (as === "button") {
    return (
      <button type="button" onClick={handle} className={className}>
        {content}
      </button>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handle}
      className={className}
    >
      {content}
    </a>
  );
}

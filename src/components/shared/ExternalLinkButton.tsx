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

  // 1) ALWAYS copy first.
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
    log("success", "clipboard.writeText", "ok");
  } catch (e) {
    log("error", "clipboard.writeText", e instanceof Error ? e.message : String(e));
  }

  // Helper that emits the right success toast based on whether copy worked.
  const notifyOpened = (method: string) => {
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
    log("info", "toast", `opened via ${method} (copied=${copied})`);
  };

  // 2) Synthetic anchor click — most reliable inside sandboxed iframes.
  //    NOTE: we cannot programmatically confirm a tab actually opened, so the
  //    description hint above keeps the wording honest if popups are blocked.
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener,noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    log("success", "anchor.click", "dispatched");
    notifyOpened("anchor");
    return { copied, opened: true, method: "anchor" };
  } catch (e) {
    log("warn", "anchor.click", e instanceof Error ? e.message : String(e));
  }

  // 3) window.open — we CAN confirm this one (returns null if blocked).
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) {
      log("success", "window.open", "got window");
      notifyOpened("window.open");
      return { copied, opened: true, method: "window.open" };
    }
    log("warn", "window.open", "returned null (popup blocked)");
  } catch (e) {
    log("error", "window.open", e instanceof Error ? e.message : String(e));
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

  // 5) Nothing worked — clipboard-only or full failure.
  if (!silent) {
    if (copied) {
      toast.warning(msg("copiedOnly"), { duration: 6500 });
    } else {
      toast.error(msg("failed"), {
        description: url,
        duration: 9000,
      });
    }
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

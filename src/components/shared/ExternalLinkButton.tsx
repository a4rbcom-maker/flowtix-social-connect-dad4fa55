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

  // 2) Synthetic anchor click.
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
    if (!silent) {
      toast.success(
        lang === "ar"
          ? `تم فتح الرابط في تبويب جديد${copied ? " ونسخه احتياطياً" : ""}. إذا لم يظهر الصقه يدوياً.`
          : `Opened in a new tab${copied ? " and copied as backup" : ""}. If it didn't appear, paste it manually.`,
        { duration: 5000 },
      );
    }
    return { copied, opened: true, method: "anchor" };
  } catch (e) {
    log("warn", "anchor.click", e instanceof Error ? e.message : String(e));
  }

  // 3) window.open
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) {
      log("success", "window.open", "got window");
      if (!silent) toast.success(lang === "ar" ? "تم فتح الرابط" : "Opened");
      return { copied, opened: true, method: "window.open" };
    }
    log("warn", "window.open", "returned null (popup blocked)");
  } catch (e) {
    log("error", "window.open", e instanceof Error ? e.message : String(e));
  }

  // 4) top-frame navigation
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url;
      log("success", "top.location", "navigated");
      return { copied, opened: true, method: "top" };
    }
    log("info", "top.location", "skipped (not in iframe)");
  } catch (e) {
    log("error", "top.location", e instanceof Error ? e.message : String(e));
  }

  // 5) clipboard-only fallback
  if (!silent) {
    if (copied) {
      toast.info(
        lang === "ar"
          ? "تعذّر فتح الرابط داخل المعاينة، لكن تم نسخه إلى الحافظة. الصقه في تبويب جديد."
          : "Couldn't open inside the preview, but the link was copied. Paste it in a new tab.",
        { duration: 7000 },
      );
    } else {
      toast.error(
        lang === "ar"
          ? `تعذّر فتح الرابط ونسخه. افتحه يدوياً: ${url}`
          : `Couldn't open or copy. Open manually: ${url}`,
        { duration: 10000 },
      );
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

// Auto-recover from stale-HTML / missing-chunk situations after a redeploy.
//
// When the server ships a new bundle, hashed asset filenames change. A
// browser that still holds the previous HTML (from bf-cache, prefetch, an
// open tab, or aggressive client caching) will try to dynamic-import chunk
// URLs that no longer exist on the server → the import rejects and the route
// renders blank.
//
// We listen for those failures and do a single hard reload with a cache-bust
// query string. The guard flag prevents reload loops if the new HTML *also*
// references a missing chunk (rare, but worth protecting against).
const RELOAD_FLAG = "__flowtix_chunk_reload";

function shouldHandle(message: string): boolean {
  if (!message) return false;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Failed to load module script") ||
    message.includes("ChunkLoadError")
  );
}

function reloadOnce() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    // sessionStorage may be unavailable; still attempt reload.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_r", Date.now().toString());
  window.location.replace(url.toString());
}

export function installStaleChunkReload() {
  if (typeof window === "undefined") return;

  // Clear the guard on a successful navigation/load so a future stale-deploy
  // event can trigger another reload.
  window.addEventListener("pageshow", () => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* noop */ }
  });

  window.addEventListener("error", (event) => {
    const msg = (event as ErrorEvent).message || String((event as ErrorEvent).error ?? "");
    if (shouldHandle(msg)) reloadOnce();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");
    if (shouldHandle(msg)) reloadOnce();
  });
}

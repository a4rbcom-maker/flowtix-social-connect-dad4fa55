import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  if (typeof atob === "function") return atob(base64);
  return Buffer.from(base64, "base64").toString("utf8");
}

function encodeBase64Url(value: string) {
  const base64 = typeof btoa === "function" ? btoa(value) : Buffer.from(value, "utf8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function rewriteStaleServerFnUrl(url: string) {
  const marker = "/_serverFn/";
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) return url;

  const idStart = markerIndex + marker.length;
  const idEnd = url.indexOf("?", idStart) === -1 ? url.length : url.indexOf("?", idStart);
  const id = url.slice(idStart, idEnd);

  try {
    const decoded = JSON.parse(decodeBase64Url(id)) as { file?: string; export?: string };
    if (
      typeof decoded.file !== "string" ||
      typeof decoded.export !== "string" ||
      decoded.file.includes("?") ||
      !decoded.file.endsWith(".functions.ts")
    ) {
      return url;
    }

    const nextId = encodeBase64Url(JSON.stringify({ ...decoded, file: `${decoded.file}?tss-serverfn-split` }));
    return `${url.slice(0, idStart)}${nextId}${url.slice(idEnd)}`;
  } catch {
    return url;
  }
}

const serverFnFetch = (url: string, requestInit: RequestInit) => fetch(rewriteStaleServerFnUrl(url), requestInit);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  functionMiddleware: [attachSupabaseAuth],
  serverFns: { fetch: serverFnFetch },
}));

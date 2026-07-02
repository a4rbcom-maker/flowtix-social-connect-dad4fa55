import type { Session, User } from "@supabase/supabase-js";

type PasswordLoginInput = { email: string; password: string };
type PasswordSignupInput = PasswordLoginInput & {
  fullName?: string;
  phone?: string;
  emailRedirectTo?: string;
};

type AuthProxyResponse = {
  ok: boolean;
  session: Session | null;
  user: User | null;
  error?: { message?: string; status?: number; code?: string };
};

export class AuthProxyError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AuthProxyError";
    this.status = status;
    this.code = code;
  }
}

export function isLikelyAuthReachabilityError(err: unknown) {
  const message = extractErrorText(err).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("fetch")
  );
}

export function extractErrorText(err: unknown) {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name, err.message);
  } else if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    for (const key of ["name", "message", "code", "status", "error", "error_description"]) {
      const value = record[key];
      if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    }
  } else {
    parts.push(String(err ?? ""));
  }
  return parts.filter(Boolean).join(" ");
}

export function getSupabaseAuthStorageKey() {
  const url = import.meta.env.VITE_SUPABASE_URL || (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
  if (!url) return "supabase.auth.token";
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "supabase.auth.token";
  }
}

export function persistServerSession(session: Session | null) {
  if (!session || typeof window === "undefined") return false;
  const storageKey = getSupabaseAuthStorageKey();
  window.localStorage.setItem(storageKey, JSON.stringify(session));
  window.localStorage.removeItem(`${storageKey}-code-verifier`);

  try {
    window.dispatchEvent(new CustomEvent("flowtix-auth-session", { detail: { session } }));
  } catch {
    // Non-critical; BroadcastChannel or next page load will pick it up.
  }

  // Notify the already-mounted Supabase client/AuthProvider in this tab.
  try {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(storageKey);
      channel.postMessage({ event: "SIGNED_IN", session });
      channel.close();
    }
  } catch {
    // Non-critical; a hard redirect after proxy login also restores the session.
  }
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Request timed out")), ms);
    }),
  ]);
}

async function postAuthProxy(path: string, body: unknown): Promise<AuthProxyResponse> {
  let response: Response;
  try {
    response = await withTimeout(
      fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      30_000,
    );
  } catch (err) {
    throw new AuthProxyError(extractErrorText(err) || "Unable to reach auth proxy", 0, "auth_proxy_unreachable");
  }

  let payload: AuthProxyResponse | null = null;
  try {
    payload = (await response.json()) as AuthProxyResponse;
  } catch {
    // handled below
  }

  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || `Authentication failed (${response.status})`;
    throw new AuthProxyError(message, payload?.error?.status ?? response.status, payload?.error?.code);
  }

  return payload;
}

export async function signInWithPasswordResilient(input: PasswordLoginInput, timeoutMs = 7_000) {
  void timeoutMs;
  const payload = await postAuthProxy("/api/public/auth/password-login", input);
  persistServerSession(payload.session);
  return { session: payload.session, user: payload.user, usedProxy: true };
}

export async function signUpWithPasswordResilient(input: PasswordSignupInput, timeoutMs = 7_000) {
  void timeoutMs;
  const payload = await postAuthProxy("/api/public/auth/password-signup", input);
  persistServerSession(payload.session);
  return { session: payload.session, user: payload.user, usedProxy: true };
}

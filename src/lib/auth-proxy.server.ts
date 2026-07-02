import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

const signupSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(200),
  fullName: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  emailRedirectTo: z.string().url().optional(),
});

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

function getSupabaseAuthClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase auth environment variables");
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("Auth proxy timed out")), ms);
    }),
  ]);
}

function authErrorResponse(err: unknown) {
  const record = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const message =
    typeof record?.message === "string"
      ? record.message
      : err instanceof Error
        ? err.message
        : "Unable to complete authentication";
  const status =
    typeof record?.status === "number"
      ? record.status
      : typeof record?.statusCode === "number"
        ? record.statusCode
        : message.toLowerCase().includes("timed out")
          ? 504
          : 502;
  const code =
    typeof record?.code === "string"
      ? record.code
      : typeof record?.error_code === "string"
        ? record.error_code
        : "auth_proxy_error";

  // Keep messages useful for the UI, but never include credentials or internals.
  console.warn("[auth-proxy] authentication failed", { status, code, message });
  return json({ ok: false, error: { message, status, code } }, { status: Math.max(400, Math.min(status, 599)) });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function safeRedirect(request: Request, requested?: string) {
  const origin = new URL(request.url).origin;
  if (!requested) return `${origin}/dashboard`;
  try {
    const url = new URL(requested);
    return url.origin === origin ? url.toString() : `${origin}/dashboard`;
  } catch {
    return `${origin}/dashboard`;
  }
}

export async function handlePasswordLogin(request: Request) {
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return json({ ok: false, error: { message: "Invalid email or password payload", code: "invalid_payload" } }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAuthClient();
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password }),
      25_000,
    );
    if (error) return authErrorResponse(error);
    if (!data.session || !data.user) {
      return json({ ok: false, error: { message: "No session returned", code: "missing_session" } }, { status: 502 });
    }
    return json({ ok: true, session: data.session, user: data.user });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function handlePasswordSignup(request: Request) {
  const parsed = signupSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return json({ ok: false, error: { message: "Invalid signup payload", code: "invalid_payload" } }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAuthClient();
    const { data, error } = await withTimeout(
      supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: {
            full_name: parsed.data.fullName,
            phone: parsed.data.phone,
          },
          emailRedirectTo: safeRedirect(request, parsed.data.emailRedirectTo),
        },
      }),
      25_000,
    );
    if (error) return authErrorResponse(error);
    return json({ ok: true, session: data.session, user: data.user });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export function handleAuthOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

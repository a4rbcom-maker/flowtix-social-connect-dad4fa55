// Centralized admin guard middleware.
// Builds on requireSupabaseAuth (which validates the bearer token and exposes
// userId/supabase in context), then verifies the user has the 'admin' role
// via the service-role client. Use this on every admin server function.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export const requireAdmin = createMiddleware({ type: "function" })
  .server(async ({ next, context }) => {
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      setResponseStatus(401);
      throw httpError(401, "Unauthorized: missing bearer token");
    }

    const token = authHeader.replace("Bearer ", "");
    const url = process.env.SUPABASE_URL;
    const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publicKey) {
      setResponseStatus(500);
      throw httpError(500, "Missing backend environment variables");
    }

    const authClient = createClient<Database>(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId) {
      setResponseStatus(401);
      throw httpError(401, "Unauthorized: invalid token");
    }

    const db = adminClient();
    const { data, error } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) {
      console.error("[requireAdmin] role lookup failed", error);
      setResponseStatus(403);
      throw httpError(403, "forbidden");
    }
    if (!data) {
      setResponseStatus(403);
      throw httpError(403, "forbidden: admin role required");
    }
    return next({
      context: {
        adminUserId: userId,
        userId,
        supabaseAdmin: db,
      },
    });
  });

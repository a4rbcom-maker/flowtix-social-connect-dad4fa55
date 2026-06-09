// Centralized admin guard middleware.
// Builds on requireSupabaseAuth (which validates the bearer token and exposes
// userId/supabase in context), then verifies the user has the 'admin' role
// via the service-role client. Use this on every admin server function.
import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const userId = context.userId;
    if (!userId) {
      setResponseStatus(401);
      throw new Error("Unauthorized");
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
      throw new Error("forbidden");
    }
    if (!data) {
      setResponseStatus(403);
      throw new Error("forbidden: admin role required");
    }
    return next({
      context: {
        adminUserId: userId,
        supabaseAdmin: db,
      },
    });
  });

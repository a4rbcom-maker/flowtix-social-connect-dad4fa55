import { supabase } from "@/lib/supabase";

export type RoleKey = "user" | "admin" | "super_admin";

export interface AuthState {
  session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null;
  profile: {
    id: string;
    user_id: string;
    email: string;
    full_name: string | null;
    avatar_url: string | null;
    status: string;
    locale: string;
    phone: string | null;
    country: string | null;
  } | null;
  role: RoleKey;
  loading: boolean;
}

export function getHomeRoute(role: RoleKey): string {
  if (role === "super_admin" || role === "admin") return "/admin";
  return "/dashboard";
}

export async function fetchProfile(userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, user_id, email, full_name, avatar_url, status, locale, phone, country")
    .eq("user_id", userId)
    .single();
  return data;
}

export async function fetchUserRole(userId: string, _workspaceId?: string | null): Promise<RoleKey> {
  try {
    const { data: isSuper } = await (supabase as any).rpc("is_super_admin");
    if (isSuper === true) return "super_admin";
  } catch {}

  const { data } = await supabase
    .from("user_roles")
    .select("roles(key)")
    .eq("user_id", userId);
  if (!data || data.length === 0) return "user";
  const keys = data.map((r: { roles: { key: string } | null }) => r.roles?.key).filter(Boolean) as string[];
  if (keys.includes("admin")) return "admin";
  return "user";
}

export async function checkPermission(permissionKey: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_permission", { p_key: permissionKey });
  return data === true;
}

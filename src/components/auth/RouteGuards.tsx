import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/authProvider";
import type { RoleKey } from "@/lib/auth";
import { LoadingState } from "@/components/ui/state";

export function RequireAuth({ allowed }: { allowed?: RoleKey[] }) {
  const { session, role, loading, homeRoute } = useAuth();
  if (loading) return <LoadingState className="min-h-screen" />;
  if (!session) return <Navigate to="/auth/login" replace />;
  if (allowed && !allowed.includes(role)) return <Navigate to={homeRoute} replace />;
  return <Outlet />;
}

export function GuestOnly() {
  const { session, loading, homeRoute } = useAuth();
  if (loading) return <LoadingState className="min-h-screen" />;
  if (session) return <Navigate to={homeRoute} replace />;
  return <Outlet />;
}

export function RoleGuard({ allowed }: { allowed: RoleKey[] }) {
  const { role, loading, homeRoute } = useAuth();
  if (loading) return <LoadingState className="min-h-screen" />;
  if (!allowed.includes(role)) return <Navigate to={homeRoute} replace />;
  return <Outlet />;
}

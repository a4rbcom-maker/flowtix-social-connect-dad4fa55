import { Outlet } from "react-router-dom";
import { AppShell } from "@/components/shared/AppShell";
import { adminNav } from "@/config/navigation";

export function AdminLayout() {
  return (
    <AppShell sections={adminNav}>
      <Outlet />
    </AppShell>
  );
}

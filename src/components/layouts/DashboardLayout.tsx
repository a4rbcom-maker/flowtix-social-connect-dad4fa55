import { Outlet } from "react-router-dom";
import { AppShell } from "@/components/shared/AppShell";
import { dashboardNav } from "@/config/navigation";

export function DashboardLayout() {
  return (
    <AppShell sections={dashboardNav}>
      <Outlet />
    </AppShell>
  );
}

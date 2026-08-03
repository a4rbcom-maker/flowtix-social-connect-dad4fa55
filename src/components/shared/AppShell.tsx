import { useState } from "react";
import type { NavSection } from "@/config/navigation";
import { Sidebar } from "./Sidebar";
import { Header, GlobalSearch } from "./Header";
import { Breadcrumb } from "./Breadcrumb";
import { DashboardFooter } from "./DashboardFooter";

export function AppShell({ sections, children }: { sections: NavSection[]; children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar
        sections={sections}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          onSearchClick={() => setSearchOpen(true)}
        />
        <Breadcrumb />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <DashboardFooter />
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

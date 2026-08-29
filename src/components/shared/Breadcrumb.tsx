import { useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  to?: string;
  key?: string;
}

function localizeSegment(seg: string, t: (k: string) => string): string {
  // Map URL segments to nav i18n keys
  const mapping: Record<string, string> = {
    "messenger": "nav.messenger",
    "compose": "nav.compose",
    "messenger-contacts": "nav.fbMessengerContacts",
    "extract-members": "nav.fbExtractMembers",
    "ai-agent": "nav.waAIAgent",
    "groups": "nav.fbGroups",
    "sessions": "nav.fbSessions",
    "settings": "nav.settings",
    "support": "nav.support",
    "profile": "nav.account",
    "subscription": "pages.subscription.title",
    "users": "admin.users.title",
    "workspaces": "admin.workspaces.title",
    "plans": "admin.plans.title",
    "subscriptions": "admin.subscriptions.title",
    "audit-logs": "admin.auditLogs.title",
    "ai-providers": "admin.aiProviders.title",
    "notifications": "admin.notifications.title",
    "security": "admin.security.title",
  };
  const key = mapping[seg] ?? `nav.${seg}`;
  const v = t(key);
  if (v && v !== key) return v;
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getBreadcrumbs(pathname: string, t: (k: string) => string): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [];
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "admin") {
    items.push({ label: t("admin.overview"), to: "/admin" });
  } else {
    items.push({ label: t("nav.dashboard"), to: "/dashboard" });
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const to = "/" + segments.slice(0, i + 1).join("/");
    items.push({ label: localizeSegment(seg, t), to, key: seg });
  }

  // last one has no link (current page)
  if (items.length > 0) {
    const last = items[items.length - 1];
    items[items.length - 1] = { label: last.label, key: last.key };
  }

  return items;
}

export function Breadcrumb() {
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language?.startsWith("ar") ?? false;
  const items = getBreadcrumbs(location.pathname, t);

  if (items.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm py-3 px-4 sm:px-6 lg:px-8"
    >
      <Link
        to={items[0].to || "/dashboard"}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] transition-colors"
      >
        <Home className="size-3.5" />
        <span className="hidden sm:inline text-xs font-medium">{items[0].label}</span>
      </Link>
      {items.slice(1).map((item, idx) => (
        <span key={item.key || idx} className="flex items-center gap-1.5">
          <ChevronLeft className={cn("size-3.5 text-[var(--color-fg-subtle)]", isRTL && "rotate-180")} aria-hidden />
          {idx === items.length - 2 ? (
            <span className="rounded-md px-1.5 py-0.5 text-sm font-semibold text-[var(--color-fg)]">
              {item.label}
            </span>
          ) : item.to ? (
            <Link
              to={item.to}
              className="rounded-md px-1.5 py-0.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] transition-colors text-xs font-medium"
            >
              {item.label}
            </Link>
          ) : (
            <span className="rounded-md px-1.5 py-0.5 font-medium text-[var(--color-fg)]">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, ChevronLeft, ChevronDown, Sparkles } from "lucide-react";
import type { NavSection, NavGroup, NavItem } from "@/config/navigation";
import { useAuth } from "@/lib/authProvider";
import { cn } from "@/lib/utils";

function NavItemLink({
  to,
  end,
  icon: Icon,
  labelKey,
  onClose,
  collapsed,
  active,
}: {
  to: string;
  end?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  onClose: () => void;
  collapsed?: boolean;
  active?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      title={collapsed ? t(labelKey) : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          collapsed && "justify-center px-0",
          (isActive || active)
            ? "bg-gradient-to-l from-[color-mix(in_oklab,var(--color-primary)_18%,transparent)] to-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] text-[var(--color-primary-soft)] shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--color-primary)_20%,transparent)]"
            : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
        )
      }
    >
      {({ isActive }) => (
        <>
          {(isActive || active) && (
            <span
              aria-hidden
              className="absolute start-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-e-full bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary-soft)] shadow-[0_0_8px_var(--color-primary)]"
            />
          )}
          <Icon className={cn("size-[1.15rem] shrink-0 transition-transform duration-200", (isActive || active) && "scale-110")} aria-hidden />
          {!collapsed && <span className="truncate">{t(labelKey)}</span>}
        </>
      )}
    </NavLink>
  );
}

function NavGroupItem({ group, collapsed, onClose }: { group: NavGroup; collapsed?: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const GroupIcon = group.icon;

  const hasSubItems = group.items && group.items.length > 0;
  const isChildActive = hasSubItems && group.items!.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/"),
  );
  const [open, setOpen] = useState(isChildActive ?? false);

  if (!hasSubItems && group.to) {
    return (
      <NavItemLink
        to={group.to}
        end={group.to === "/dashboard" || group.to === "/admin"}
        icon={GroupIcon}
        labelKey={group.labelKey}
        onClose={onClose}
        collapsed={collapsed}
      />
    );
  }

  const isExpanded = open || Boolean(isChildActive);

  return (
    <div>
      <button
        onClick={() => !collapsed && setOpen((v) => !v)}
        title={collapsed ? t(group.labelKey) : undefined}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
          collapsed && "justify-center px-0",
          isChildActive
            ? "text-[var(--color-primary-soft)]"
            : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
        )}
      >
        {isChildActive && (
          <span
            aria-hidden
            className="absolute start-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-e-full bg-gradient-to-b from-[var(--color-primary)] to-[var(--color-primary-soft)] shadow-[0_0_8px_var(--color-primary)]"
          />
        )}
        <GroupIcon className={cn("size-[1.15rem] shrink-0 transition-transform duration-200", isChildActive && "scale-110")} aria-hidden />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-start">{t(group.labelKey)}</span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-[var(--color-fg-subtle)] transition-transform duration-300",
                isExpanded && "rotate-180 text-[var(--color-primary-soft)]",
              )}
            />
          </>
        )}
      </button>
      {!collapsed && (
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <ul className="mt-1 space-y-0.5 ps-3">
              {group.items!.map((item, idx) => (
                <SubNavItem
                  key={item.key}
                  item={item}
                  onClose={onClose}
                  index={idx}
                  isOpen={isExpanded}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SubNavItem({
  item,
  onClose,
  index,
  isOpen,
}: {
  item: NavItem;
  onClose: () => void;
  index: number;
  isOpen: boolean;
}) {
  const location = useLocation();
  const { t } = useTranslation();
  const Icon = item.icon;
  const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + "/");

  return (
    <li
      className={cn(
        "transition-all duration-300 ease-out",
        isOpen ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0",
      )}
      style={{ transitionDelay: isOpen ? `${index * 30}ms` : "0ms" }}
    >
      <NavLink
        to={item.to}
        onClick={onClose}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[0.82rem] font-medium transition-all duration-200",
          isActive
            ? "bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary-soft)]"
            : "text-[var(--color-fg-subtle)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
        )}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute start-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-e-full bg-[var(--color-primary-soft)]"
          />
        )}
        <Icon
          className={cn(
            "size-[0.95rem] shrink-0 transition-transform duration-200",
            isActive && "scale-110",
          )}
          aria-hidden
        />
        <span className="truncate">{t(item.labelKey)}</span>
        {isActive && (
          <span
            aria-hidden
            className="ms-auto size-1.5 rounded-full bg-[var(--color-primary-soft)] shadow-[0_0_6px_var(--color-primary-soft)]"
          />
        )}
      </NavLink>
    </li>
  );
}

export function Sidebar({
  sections,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  sections: NavSection[];
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language?.startsWith("ar") ?? true;
  const { profile, session } = useAuth();
  const userEmail = session?.user?.email ?? "";

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "FT";
  const displayName = profile?.full_name || t("nav.user", "User");

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden
      />

      <aside
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col border-e border-[var(--color-border)] bg-[var(--color-bg-elevated)]/95 backdrop-blur-xl transition-all duration-300 ease-in-out lg:static",
          isRTL ? "right-0" : "left-0",
          "w-[min(85vw,20rem)] sm:w-72",
          open ? "translate-x-0" : (isRTL ? "translate-x-full" : "-translate-x-full"),
          "lg:translate-x-0",
          collapsed && "lg:w-[4.5rem]",
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-[var(--color-border)] px-4", collapsed && "justify-center px-0")}>
          <NavLink to="/" aria-label={t("brand.name")} className={cn("flex items-center gap-2.5", collapsed && "gap-0")}>
            <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl gradient-brand shadow-[0_6px_18px_-6px_rgba(109,94,252,0.7)]">
              <svg viewBox="0 0 24 24" fill="none" className="size-5 text-white" aria-hidden>
                <path d="M4 7h11M4 12h16M4 17h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="18.5" cy="7" r="2" fill="currentColor" />
              </svg>
            </span>
            {!collapsed && (
              <span className="text-[1.05rem] font-extrabold tracking-tight text-[var(--color-fg)] whitespace-nowrap">
                Flow<span className="text-[var(--color-primary-soft)]">Tix</span>
              </span>
            )}
          </NavLink>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] ms-auto lg:hidden"
            aria-label={t("nav.closeMenu")}
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className={cn("flex-1 overflow-y-auto px-3 py-4 scrollbar-thin", collapsed && "px-2")}>
          {sections.map((section, sectionIdx) => (
            <div key={section.key} className={cn(sectionIdx > 0 && "mt-4")}>
              {!collapsed && section.titleKey && (
                <div className="mb-1.5 flex items-center gap-2 px-3">
                  <span className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    {t(section.titleKey)}
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-[var(--color-border)] to-transparent" />
                </div>
              )}
              <div className="space-y-0.5">
                {section.groups.map((group) => (
                  <NavGroupItem key={group.key} group={group} collapsed={collapsed} onClose={onClose} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn("border-t border-[var(--color-border)] p-3", collapsed && "p-2")}>
          {!collapsed ? (
            <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-bg-elevated)] p-3">
              <div className="pointer-events-none absolute -top-12 -end-12 size-24 rounded-full bg-[var(--color-primary)]/10 blur-2xl" aria-hidden />
              <div className="relative flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full gradient-brand text-xs font-bold text-white shrink-0 shadow-[0_4px_12px_-2px_rgba(109,94,252,0.5)]">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{displayName}</p>
                  <p className="truncate text-xs text-[var(--color-fg-subtle)]">{userEmail || profile?.email || ""}</p>
                </div>
                <span className="flex size-7 items-center justify-center rounded-md bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]">
                  <Sparkles className="size-3.5" aria-hidden />
                </span>
              </div>
            </div>
          ) : (
            <div className="flex size-9 mx-auto items-center justify-center rounded-full gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-2px_rgba(109,94,252,0.5)]">
              {initials}
            </div>
          )}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className={cn(
                "mt-2 hidden lg:flex items-center justify-center w-full rounded-lg p-2 text-[var(--color-fg-muted)] transition-all duration-200 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
              )}
              aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            >
              <ChevronLeft className={cn("size-4 transition-transform duration-200", (isRTL ? !collapsed : collapsed) && "rotate-180")} />
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

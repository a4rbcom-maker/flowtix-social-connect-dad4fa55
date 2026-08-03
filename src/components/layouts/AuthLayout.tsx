import { Outlet, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

export function AuthLayout() {
  const { t } = useTranslation();

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--color-bg)]">
      <div className="pointer-events-none absolute inset-0 bg-radial-glow" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.15] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" aria-hidden />

      {/* Unified header bar — h-16 matches Navbar and dashboard Header */}
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-[var(--color-border)] glass-strong px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label={t("brand.name")}>
            <Logo />
          </Link>
          <Link
            to="/"
            className="hidden items-center gap-1.5 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] sm:inline-flex"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t("auth.backHome")}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[var(--color-border)] glass-strong p-6 shadow-[var(--shadow-xl)] sm:rounded-3xl sm:p-8 md:p-10">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}

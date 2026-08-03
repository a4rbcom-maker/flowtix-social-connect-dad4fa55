import { useTranslation } from "react-i18next";
import { ScrollToTop } from "@/components/shared/ScrollToTop";
import { Logo } from "@/components/shared/Logo";

export function DashboardFooter() {
  const { t } = useTranslation();
  return (
    <>
      <footer className="relative border-t border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur-sm px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="scale-90 origin-start">
              <Logo />
            </span>
            <p className="text-xs text-[var(--color-fg-muted)]">
              &copy; {new Date().getFullYear()} FlowTix Tools · {t("brand.tagline")}
            </p>
          </div>
          <nav className="flex items-center gap-1 text-xs text-[var(--color-fg-muted)]" />
        </div>
      </footer>
      <ScrollToTop />
    </>
  );
}

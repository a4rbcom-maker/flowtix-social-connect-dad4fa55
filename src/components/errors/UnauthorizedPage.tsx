import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";

export function UnauthorizedPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="flex flex-col items-center gap-5 text-center max-w-md">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)]">
          <ShieldX className="size-10" />
        </div>
        <div className="space-y-3">
          <p className="text-7xl font-extrabold tracking-tighter text-[var(--color-primary)]">403</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("errors.unauthorized.title")}
          </h1>
          <p className="text-base text-[var(--color-fg-muted)]">
            {t("errors.unauthorized.description")}
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/dashboard">
            <Button variant="outline">{t("errors.goDashboard")}</Button>
          </Link>
          <Link to="/">
            <Button variant="primary">{t("errors.goHome")}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";

export function SessionExpiredPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="flex flex-col items-center gap-5 text-center max-w-md">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]">
          <Clock className="size-10" />
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("errors.sessionExpired.title")}
          </h1>
          <p className="text-base text-[var(--color-fg-muted)]">
            {t("errors.sessionExpired.description")}
          </p>
        </div>
        <Link to="/auth/login">
          <Button variant="primary" size="lg">{t("errors.sessionExpired.login")}</Button>
        </Link>
      </div>
    </div>
  );
}

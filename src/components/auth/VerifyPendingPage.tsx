import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VerifyPendingPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]">
          <Clock className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("auth.verifyPending.title")}
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xs mx-auto">
            {t("auth.verifyPending.subtitle")}
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/auth/verify-email">
            <Button variant="outline">{t("auth.verifyPending.resend")}</Button>
          </Link>
          <Link to="/auth/login">
            <Button variant="primary">{t("auth.verifyPending.login")}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

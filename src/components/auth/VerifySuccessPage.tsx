import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function VerifySuccessPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]">
          <CheckCircle2 className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("auth.verifySuccess.title")}
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xs mx-auto">
            {t("auth.verifySuccess.subtitle")}
          </p>
        </div>
        <Link to="/auth/login">
          <Button variant="primary" size="lg">{t("auth.verifySuccess.login")}</Button>
        </Link>
      </div>
    </div>
  );
}

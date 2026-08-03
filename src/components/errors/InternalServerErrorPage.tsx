import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ServerCrash } from "lucide-react";

export function InternalServerErrorPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="flex flex-col items-center gap-5 text-center max-w-md">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)]">
          <ServerCrash className="size-10" />
        </div>
        <div className="space-y-3">
          <p className="text-7xl font-extrabold tracking-tighter text-[var(--color-error)]">500</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("errors.serverError.title")}
          </h1>
          <p className="text-base text-[var(--color-fg-muted)]">
            {t("errors.serverError.description")}
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
          {t("errors.serverError.retry")}
        </Button>
      </div>
    </div>
  );
}

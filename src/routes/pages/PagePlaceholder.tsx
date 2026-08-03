import { useTranslation } from "react-i18next";
import { Construction } from "lucide-react";
import { Card } from "@/components/ui/card";

export function PagePlaceholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl py-10">
      <Card className="flex flex-col items-center justify-center gap-4 border-dashed py-20 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-primary-soft)]">
          <Construction className="size-8" aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            {t("common.loading")}
          </p>
        </div>
      </Card>
    </div>
  );
}

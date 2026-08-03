import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Database, ArrowRight, Zap, Plug, Clock } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { extractionTools, type ExtractionType } from "./config";

export function ExtractionHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function startExtraction(type: ExtractionType) {
    navigate(`/dashboard/extraction/new/${type}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("extraction.title")} description={t("extraction.subtitle")} icon={Database} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {extractionTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card key={tool.type} className="card-hover group flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-4 pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-110">
                    <Icon className="size-6" />
                  </div>
                  <Badge variant="primary">
                    <Zap className="size-3" />
                    {t(tool.speedKey)}
                  </Badge>
                </div>

                <div className="flex-1">
                  <h3 className="text-base font-bold text-[var(--color-fg)]">{t(tool.titleKey)}</h3>
                  <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t(tool.descKey)}</p>
                </div>

                <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                    <Plug className="size-3.5" />
                    <span>{t("extraction.requiredSession")}:</span>
                    <span className="font-medium text-[var(--color-fg-muted)]">{t(tool.sessionKey)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                    <Clock className="size-3.5" />
                    <span>{t("extraction.estimatedDuration")}:</span>
                    <span className="font-medium text-[var(--color-fg-muted)]">{tool.estimateDuration}</span>
                  </div>
                </div>

                <Button onClick={() => startExtraction(tool.type)} className="w-full">
                  {t("extraction.start")}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

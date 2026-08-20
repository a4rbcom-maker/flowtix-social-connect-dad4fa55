import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Users, Loader2, ChevronLeft, ChevronRight, ShieldCheck, ShieldQuestion, Phone, Mail, Instagram, Facebook } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { ExtractionResult, PlatformFilter } from "@/lib/extraction/types";

const PAGE_SIZE = 25;

interface EnrichmentMeta {
  enrichment?: Record<string, unknown>;
  match_confidence?: "confirmed" | "probable";
  match_method?: "bio_phone" | "bio_email" | "full_name";
  platform?: string;
}

function getMeta(row: ExtractionResult): EnrichmentMeta {
  return (row.metadata as EnrichmentMeta) ?? {};
}

export function ResultsPage() {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["all-results", platform, page],
    queryFn: () => extractionRepository.getAllResults(platform, page, PAGE_SIZE),
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;

  const filters: { value: PlatformFilter; label: string; icon?: typeof Users }[] = [
    { value: "all", label: t("results.filter.all") },
    { value: "facebook", label: t("results.filter.facebook"), icon: Facebook },
    { value: "instagram", label: t("results.filter.instagram"), icon: Instagram },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("results.title")} description={t("results.subtitle")} icon={Users} />

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          const Icon = f.icon;
          return (
            <Button
              key={f.value}
              variant={platform === f.value ? "primary" : "secondary"}
              size="sm"
              onClick={() => { setPlatform(f.value); setPage(0); }}
            >
              {Icon ? <Icon className="size-4" /> : null}
              {f.label}
            </Button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[var(--color-fg-muted)]">
              <Loader2 className="size-5 animate-spin" />
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-[var(--color-error)]">{t("common.error")}</div>
          ) : !data || data.data.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--color-fg-subtle)]">{t("results.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-fg-muted)]">
                    <th className="py-2.5 px-3 text-start font-semibold">#</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t("results.col.name")}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t("results.col.platform")}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t("results.col.phone")}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t("results.col.email")}</th>
                    <th className="py-2.5 px-3 text-start font-semibold">{t("results.col.confidence")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, i) => {
                    const meta = getMeta(row);
                    const d = row.data as Record<string, unknown>;
                    const enrichment = meta.enrichment ?? {};
                    const phone = (enrichment.phone as string) ?? (d.bio_phone as string) ?? "—";
                    const email = (enrichment.email as string) ?? (d.bio_email as string) ?? "—";
                    const name = (d.full_name as string) ?? (d.name as string) ?? row.fb_id ?? "—";
                    const confidence = meta.match_confidence;
                    return (
                      <tr key={row.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]">
                        <td className="py-2.5 px-3 text-[var(--color-fg-subtle)]">{page * PAGE_SIZE + i + 1}</td>
                        <td className="py-2.5 px-3 font-medium text-[var(--color-fg)]">{name}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={row.platform === "instagram" ? "primary" : "outline"}>
                            {row.platform === "instagram"
                              ? <><Instagram className="size-3" /> {t("results.platform.instagram")}</>
                              : <><Facebook className="size-3" /> {t("results.platform.facebook")}</>}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs text-[var(--color-fg-muted)]">
                          {phone !== "—" ? <span className="inline-flex items-center gap-1"><Phone className="size-3" />{phone}</span> : phone}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-[var(--color-fg-muted)]">
                          {email !== "—" ? <span className="inline-flex items-center gap-1"><Mail className="size-3" />{email}</span> : email}
                        </td>
                        <td className="py-2.5 px-3">
                          {confidence === "confirmed" ? (
                            <Badge variant="success">
                              <ShieldCheck className="size-3" />
                              {t("results.confidence.confirmed")}
                            </Badge>
                          ) : confidence === "probable" ? (
                            <Badge variant="warning">
                              <ShieldQuestion className="size-3" />
                              {t("results.confidence.probable")}
                            </Badge>
                          ) : (
                            <span className="text-xs text-[var(--color-fg-subtle)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.count > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[var(--color-fg-subtle)]">
            {t("results.showing")} {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.count)} {t("results.of")} {data.count.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
            <span className="px-3 text-xs text-[var(--color-fg-muted)]">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardDrive, RefreshCw, AlertTriangle, FileWarning, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { scanOrphanStorage } from "@/lib/orphan-storage.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/storage")({ ssr: false, component: AdminStoragePage });

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

function AdminStoragePage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const scan = useServerFn(scanOrphanStorage);

  const m = useMutation({
    mutationFn: () => scan({ data: undefined as any }),
    onError: (err: any) => toast.error(err?.message || t("فشل الفحص", "Scan failed")),
    onSuccess: () => toast.success(t("اكتمل الفحص", "Scan complete")),
  });

  const data = m.data;
  const totalOrphanBytes = data?.total_orphan_bytes ?? 0;
  const totalOrphanCount = data?.total_orphan_count ?? 0;

  const buckets = useMemo(() => data?.buckets ?? [], [data]);

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HardDrive className="w-6 h-6 text-primary" />
              {t("فحص ملفات التخزين اليتيمة", "Orphan storage scan")}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t(
                "يقارن ملفات كل bucket بمراجع قاعدة البيانات ويعرض التقرير فقط — لا يحذف أي شيء.",
                "Compares each bucket's files against DB references and reports only — never deletes.",
              )}
            </p>
          </div>
          <button
            onClick={() => m.mutate()}
            disabled={m.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {m.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {m.isPending ? t("جاري الفحص…", "Scanning…") : t("تشغيل الفحص", "Run scan")}
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <SummaryCard
              icon={<FileWarning className="w-5 h-5 text-amber-500" />}
              label={t("عدد الملفات اليتيمة", "Orphan files")}
              value={totalOrphanCount.toLocaleString()}
            />
            <SummaryCard
              icon={<HardDrive className="w-5 h-5 text-primary" />}
              label={t("حجم الملفات اليتيمة", "Orphan size")}
              value={fmtBytes(totalOrphanBytes)}
            />
            <SummaryCard
              icon={<AlertTriangle className="w-5 h-5 text-destructive" />}
              label={t("وقت التقرير", "Report time")}
              value={new Date(data.generated_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
            />
          </div>
        )}

        <div className="space-y-4">
          {buckets.map((b) => (
            <div key={b.bucket} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-semibold text-lg">
                  <span className="font-mono">{b.bucket}</span>
                </h2>
                {b.note && (
                  <span className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {b.note}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-sm">
                <Stat label={t("ملفات في التخزين", "Storage objects")} value={b.storage_object_count.toLocaleString()} />
                <Stat label={t("الحجم الكلي", "Total size")} value={fmtBytes(b.storage_total_bytes)} />
                <Stat label={t("مسارات مُشار إليها في DB", "DB references")} value={b.referenced_paths_count.toLocaleString()} />
                <Stat
                  label={t("يتيم (بدون مرجع)", "Orphan (no ref)")}
                  value={`${b.orphan_count.toLocaleString()} · ${fmtBytes(b.orphan_total_bytes)}`}
                  tone={b.orphan_count > 0 ? "warn" : "ok"}
                />
                <Stat
                  label={t("مفقود من التخزين", "Missing in storage")}
                  value={b.missing_in_storage_count.toLocaleString()}
                  tone={b.missing_in_storage_count > 0 ? "danger" : "ok"}
                />
              </div>

              {b.orphan_sample.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    {t("عيّنة من الملفات اليتيمة", "Sample orphan files")} ({b.orphan_sample.length})
                  </summary>
                  <ul className="mt-2 text-xs font-mono space-y-1 max-h-72 overflow-auto bg-muted/40 p-3 rounded-md">
                    {b.orphan_sample.map((o) => (
                      <li key={o.path} className="flex justify-between gap-3">
                        <span className="truncate">{o.path}</span>
                        <span className="text-muted-foreground shrink-0">
                          {o.size_bytes != null ? fmtBytes(o.size_bytes) : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {b.missing_sample.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-destructive">
                    {t("عيّنة مراجع بدون ملف فعلي", "Sample DB refs without a file")} ({b.missing_sample.length})
                  </summary>
                  <ul className="mt-2 text-xs font-mono space-y-1 max-h-72 overflow-auto bg-muted/40 p-3 rounded-md">
                    {b.missing_sample.map((p) => (
                      <li key={p} className="truncate">{p}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>

        {!data && !m.isPending && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {t(
              "اضغط «تشغيل الفحص» لتوليد التقرير. الفحص للقراءة فقط ولا يحذف أي ملف.",
              "Click “Run scan” to generate the report. This scan is read-only and never deletes files.",
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="rounded-lg bg-muted p-2">{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

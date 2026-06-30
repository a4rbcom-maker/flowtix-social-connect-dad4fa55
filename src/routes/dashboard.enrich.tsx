import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Sparkles, Loader2, Upload, MapPin, Database } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { enrichLines, type EnrichedLead } from "@/lib/egypt-enrich";
import { matchLeadsAgainstCustomers, type MatchResult } from "@/lib/customer-db";

export const Route = createFileRoute("/dashboard/enrich")({
  ssr: false,
  component: EnrichPage,
});

function EnrichPage() {
  const { lang } = useI18n();
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<EnrichedLead[]>([]);
  const [matches, setMatches] = useState<Map<number, MatchResult>>(new Map());
  const [busy, setBusy] = useState(false);

  const runMatching = async (data: EnrichedLead[]) => {
    try {
      const m = await matchLeadsAgainstCustomers(
        data.map((r) => ({ raw: r.raw, name: r.name, phone: r.phone, email: r.email })),
      );
      setMatches(m);
      if (m.size > 0) {
        toast.success(lang === "ar" ? `🎯 تم التعرف على ${m.size} عميل من قاعدة عملائك` : `🎯 Matched ${m.size} from your DB`);
      }
    } catch { /* silent */ }
  };


  // Auto-fill from a job's results when navigated from history page.
  useEffect(() => {
    try {
      const pre = sessionStorage.getItem("flowtix:enrich:prefill");
      if (pre && pre.trim()) {
        setInput(pre);
        sessionStorage.removeItem("flowtix:enrich:prefill");
        // Auto-run after state settles
        setTimeout(() => {
          const lines = pre.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (lines.length > 0) {
            setBusy(true);
            enrichLines(lines)
              .then((data) => {
                setRows(data);
                toast.success(lang === "ar" ? `تم إثراء ${data.length} سطر` : `Enriched ${data.length} rows`);
                void runMatching(data);
              })
              .catch((e) => toast.error(String(e)))
              .finally(() => setBusy(false));
          }
        }, 50);
      }
    } catch (_) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = lang === "ar" ? {
    title: "إثراء العملاء",
    subtitle: "الصق نص أو قائمة (سطر لكل عميل) ونستخرج تلقائياً الاسم، رقم الموبايل، الإيميل، المدينة والمحافظة من قاعدة بيانات مصر.",
    inputLabel: "النص أو القائمة",
    placeholder: "أحمد محمد 01012345678 ahmed@mail.com من الزقازيق\nمنى صلاح 01551234567 المنصورة\nمحمد علي - 6 أكتوبر - 01112223344",
    upload: "رفع ملف نصي/CSV",
    process: "تحليل وإثراء",
    clear: "مسح",
    download: "تنزيل CSV",
    none: "لا توجد نتائج بعد",
    summary: (n: number, w: number, p: number, e: number, c: number) =>
      `${n} سطر • ${w} باسم • ${p} برقم • ${e} بإيميل • ${c} بمحافظة`,
    cols: { name: "الاسم", phone: "موبايل", email: "إيميل", city: "المدينة", gov: "المحافظة", raw: "النص الأصلي" },
    matched: "تم التعرف",
    emptyHint: "النتائج بدون أرقام/مدن؟ ده طبيعي مع أعضاء الجروبات لأن فيسبوك بيرجّع الاسم بس. شغّل «فحص عميق للبروفايلات» من سجل المهام عشان نفتح كل بروفايل ونسحب البيو والمدينة والشغل، وبعدها اعمل إثراء تاني.",
  } : {
    title: "Enrich leads",
    subtitle: "Paste text or a list (one lead per line) and we'll extract name, mobile, email, city and governorate using the Egypt locations dataset.",
    inputLabel: "Text or list",
    placeholder: "Ahmed Mohamed 01012345678 ahmed@mail.com from Zagazig\nMona Salah 01551234567 Mansoura\nMohamed Ali - 6th October - 01112223344",
    upload: "Upload text/CSV file",
    process: "Analyze & enrich",
    clear: "Clear",
    download: "Download CSV",
    none: "No results yet",
    summary: (n: number, w: number, p: number, e: number, c: number) =>
      `${n} rows • ${w} with name • ${p} with phone • ${e} with email • ${c} with governorate`,
    cols: { name: "Name", phone: "Mobile", email: "Email", city: "City", gov: "Governorate", raw: "Source" },
    matched: "Matched",
    emptyHint: "No phones/cities in results? That's expected for group members — Facebook only returns the name. Run \"Deep profile scrape\" from Jobs History to open each profile and pull bio, city and work, then re-enrich.",
  };

  const run = async () => {
    const lines = input.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error(lang === "ar" ? "أدخل بيانات أولاً" : "Add some text first"); return; }
    setBusy(true);
    try {
      const data = await enrichLines(lines);
      setRows(data);
      toast.success(lang === "ar" ? `تم إثراء ${data.length} سطر` : `Enriched ${data.length} rows`);
      void runMatching(data);
    } catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    setInput(text);
  };

  const downloadCsv = () => {
    if (rows.length === 0) return;
    const head = ["name", "phone", "email", "city", "governorate", "source"];
    const csv = [head, ...rows.map((r) => [r.name ?? "", r.phone ?? "", r.email ?? "", r.city ?? "", r.governorate ?? "", r.raw])]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `enriched-leads-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const stats = {
    name: rows.filter((r) => r.name).length,
    phone: rows.filter((r) => r.phone).length,
    email: rows.filter((r) => r.email).length,
    gov: rows.filter((r) => r.governorate).length,
  };
  const noContact = rows.length > 0 && stats.phone === 0 && stats.email === 0 && stats.gov === 0;

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">{t.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t.subtitle}</p>
        </div>

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium">{t.inputLabel}</label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" />{t.upload}
                <input type="file" accept=".txt,.csv,.tsv,text/*" className="hidden" onChange={onFile} />
              </label>
              {input && (
                <Button size="sm" variant="ghost" onClick={() => { setInput(""); setRows([]); }}>{t.clear}</Button>
              )}
            </div>
          </div>
          <Textarea
            rows={8}
            placeholder={t.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="font-mono text-sm"
          />
          <Button onClick={run} disabled={busy || !input.trim()} className="w-full gap-2 sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t.process}
          </Button>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary" />
              {rows.length > 0 ? t.summary(rows.length, stats.name, stats.phone, stats.email, stats.gov) : t.none}
            </div>
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={downloadCsv} className="gap-2">
                <Download className="h-4 w-4" />{t.download}
              </Button>
            )}
          </div>
          {noContact && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
              {t.emptyHint}
            </div>
          )}
          {rows.length > 0 && (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start">#</th>
                    <th className="px-4 py-2 text-start">{t.cols.name}</th>
                    <th className="px-4 py-2 text-start">{t.cols.phone}</th>
                    <th className="px-4 py-2 text-start">{t.cols.email}</th>
                    <th className="px-4 py-2 text-start">{t.cols.city}</th>
                    <th className="px-4 py-2 text-start">{t.cols.gov}</th>
                    <th className="px-4 py-2 text-start">{t.cols.raw}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r, i) => (
                    <tr key={i} className={r.governorate ? "bg-primary/[0.03]" : ""}>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2 font-medium">{r.name ?? "—"}</td>
                      <td className="px-4 py-2 font-mono">{r.phone ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.email ?? "—"}</td>
                      <td className="px-4 py-2">{r.city ?? "—"}</td>
                      <td className="px-4 py-2">
                        {r.governorate ? <Badge variant="outline" className="border-primary/30 text-primary">{r.governorate}</Badge> : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground line-clamp-2 max-w-md">{r.raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Copy, Loader2, Users, Search, Phone, FileText, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { extractInboundContacts, type ExtractedContact } from "@/lib/wa-chat.functions";
import { extractAllEgyptPhones } from "@/lib/egypt-enrich";

export const Route = createFileRoute("/dashboard/whatsapp/contacts")({
  ssr: false,
  component: ContactsPage,
});


function isoStart(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}
function isoEnd(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function ContactsPage() {
  const { lang, dir } = useI18n();
  const extract = useServerFn(extractInboundContacts);
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo] = useState(todayStr());
  const [includeGroups, setIncludeGroups] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ExtractedContact[]>([]);
  const [searched, setSearched] = useState(false);
  const [q, setQ] = useState("");

  const T = lang === "ar"
    ? {
        title: "استخراج أرقام الواتساب",
        subtitle: "استخرج كل أرقام الناس اللي راسلوك خلال فترة زمنية معينة",
        from: "من تاريخ",
        to: "إلى تاريخ",
        groups: "تضمين الجروبات",
        run: "استخراج الأرقام",
        loading: "جاري الاستخراج...",
        quick: "اختصارات",
        today: "اليوم",
        d7: "آخر 7 أيام",
        d30: "آخر 30 يوم",
        d90: "آخر 90 يوم",
        result: "النتائج",
        empty: "لم يراسلك أحد في هذه الفترة.",
        none: "اضغط «استخراج» لعرض الأرقام.",
        unique: "رقم فريد",
        messages: "رسالة",
        copyAll: "نسخ كل الأرقام",
        downloadCsv: "تنزيل CSV",
        copied: "تم النسخ",
        search: "بحث بالاسم أو الرقم",
        name: "الاسم",
        phone: "الرقم",
        count: "عدد الرسائل",
        first: "أول رسالة",
        last: "آخر رسالة",
        copyOne: "نسخ",
      }
    : {
        title: "Extract WhatsApp Numbers",
        subtitle: "Export all phone numbers of people who messaged you within a date range",
        from: "From",
        to: "To",
        groups: "Include groups",
        run: "Extract numbers",
        loading: "Extracting...",
        quick: "Quick ranges",
        today: "Today",
        d7: "Last 7 days",
        d30: "Last 30 days",
        d90: "Last 90 days",
        result: "Results",
        empty: "No one messaged you in this period.",
        none: "Click \"Extract\" to view numbers.",
        unique: "unique numbers",
        messages: "messages",
        copyAll: "Copy all numbers",
        downloadCsv: "Download CSV",
        copied: "Copied",
        search: "Search by name or number",
        name: "Name",
        phone: "Phone",
        count: "Messages",
        first: "First message",
        last: "Last message",
        copyOne: "Copy",
      };

  const setRange = (days: number) => {
    setFrom(daysAgoStr(days));
    setTo(todayStr());
  };

  const handleRun = async () => {
    if (from > to) {
      toast.error(lang === "ar" ? "تاريخ البداية بعد النهاية" : "Start date is after end date");
      return;
    }
    setLoading(true);
    try {
      const result = await extract({ data: { from: isoStart(from), to: isoEnd(to), includeGroups } });
      setRows(result);
      setSearched(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.phone.includes(term) || (r.name ?? "").toLowerCase().includes(term),
    );
  }, [rows, q]);

  const totalMessages = useMemo(() => rows.reduce((s, r) => s + r.message_count, 0), [rows]);

  const handleCopyAll = async () => {
    const text = filtered.map((r) => r.phone).join("\n");
    await navigator.clipboard.writeText(text);
    toast.success(T.copied + ` (${filtered.length})`);
  };

  const handleCopyOne = async (phone: string) => {
    await navigator.clipboard.writeText(phone);
    toast.success(T.copied);
  };

  const handleCsv = () => {
    const header = ["phone", "name", "remote_jid", "message_count", "first_at", "last_at"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [r.phone, r.name ?? "", r.remote_jid, String(r.message_count), r.first_at, r.last_at]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `whatsapp-contacts-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <DashboardLayout title={T.title}>
      <div dir={dir} className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-primary-foreground shadow-md">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{T.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{T.subtitle}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">{T.from}</Label>
              <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{T.to}</Label>
              <Input id="to" type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeGroups}
                  onChange={(e) => setIncludeGroups(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                {T.groups}
              </label>
            </div>
            <div className="flex items-end">
              <Button onClick={handleRun} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {loading ? T.loading : T.run}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{T.quick}:</span>
            <Button size="sm" variant="outline" onClick={() => setRange(0)}>{T.today}</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(7)}>{T.d7}</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(30)}>{T.d30}</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(90)}>{T.d90}</Button>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-border/50 bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-4">
            <div>
              <h3 className="font-semibold text-foreground">{T.result}</h3>
              {searched && (
                <p className="text-xs text-muted-foreground">
                  {rows.length} {T.unique} · {totalMessages} {T.messages}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder={T.search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-9 w-56"
              />
              <Button size="sm" variant="outline" onClick={handleCopyAll} disabled={!filtered.length}>
                <Copy className="h-4 w-4" />{T.copyAll}
              </Button>
              <Button size="sm" onClick={handleCsv} disabled={!filtered.length}>
                <Download className="h-4 w-4" />{T.downloadCsv}
              </Button>
            </div>
          </div>

          {!searched ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{T.none}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{T.empty}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start">{T.phone}</th>
                    <th className="px-4 py-2 text-start">{T.name}</th>
                    <th className="px-4 py-2 text-start">{T.count}</th>
                    <th className="px-4 py-2 text-start">{T.first}</th>
                    <th className="px-4 py-2 text-start">{T.last}</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.remote_jid} className="border-t border-border/40 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-primary" />
                          {r.phone}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{r.name || "—"}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex min-w-8 justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {r.message_count}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{fmt(r.first_at)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{fmt(r.last_at)}</td>
                      <td className="px-4 py-2 text-end">
                        <Button size="sm" variant="ghost" onClick={() => handleCopyOne(r.phone)}>
                          <Copy className="h-3.5 w-3.5" />{T.copyOne}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { ScrollText, Search, Filter, Loader2, Send, ShieldCheck, Download, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminLogs } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/logs")({ ssr: false, component: LogsPage });

function LogsPage() {
  const { lang, dir } = useI18n();
  const fetchFn = useServerFn(getAdminLogs);
  const [kind, setKind] = useState<"send" | "audit">("send");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "logs", kind, search, channel, status],
    queryFn: () => fetchFn({ data: { kind, search: search || undefined, channel: channel || undefined, status: status || undefined, limit: 300 } }),
    refetchInterval: 20000,
  });

  const rows = data?.rows ?? [];

  const downloadCsv = () => {
    if (!rows.length) return;
    const headers = kind === "send"
      ? ["created_at", "user", "channel", "action", "status", "title", "recipient", "error_message"]
      : ["created_at", "admin", "action", "target_user", "target_type", "target_id"];
    const csv = [headers.join(",")].concat(
      rows.map((r: any) => {
        if (kind === "send") {
          return [r.created_at, r.user?.full_name ?? r.user_id, r.channel, r.action, r.status, r.title, r.recipient ?? "", (r.error_message ?? "").replace(/[\n,]/g, " ")].map((v) => `"${String(v ?? "")}"`).join(",");
        }
        return [r.created_at, r.admin?.full_name ?? r.admin_user_id, r.action, r.target?.full_name ?? r.target_user_id ?? "", r.target_type ?? "", r.target_id ?? ""].map((v) => `"${String(v ?? "")}"`).join(",");
      }),
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `admin-${kind}-log-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    if (kind !== "send") return null;
    const total = rows.length;
    const sent = rows.filter((r: any) => r.status === "sent" || r.status === "delivered").length;
    const failed = rows.filter((r: any) => r.status === "failed").length;
    const pending = rows.filter((r: any) => r.status === "pending" || r.status === "queued").length;
    return { total, sent, failed, pending };
  }, [rows, kind]);

  return (
    <AdminLayout title={lang === "ar" ? "سجلات النظام" : "System Logs"}>
      <div dir={dir} className="space-y-6">
        {/* Tabs */}
        <div className="inline-flex rounded-xl border border-border bg-card/70 backdrop-blur-xl p-1">
          {(["send", "audit"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${kind === k ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              {k === "send" ? <Send className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {lang === "ar" ? (k === "send" ? "سجل الإرسال" : "سجل الأدمن") : (k === "send" ? "Send Log" : "Admin Audit")}
            </button>
          ))}
        </div>

        {/* Stats for send log */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: lang === "ar" ? "الإجمالي" : "Total", value: stats.total, icon: ScrollText, color: "text-primary" },
              { label: lang === "ar" ? "ناجح" : "Sent", value: stats.sent, icon: CheckCircle2, color: "text-emerald-500" },
              { label: lang === "ar" ? "فشل" : "Failed", value: stats.failed, icon: XCircle, color: "text-rose-500" },
              { label: lang === "ar" ? "معلّق" : "Pending", value: stats.pending, icon: Clock, color: "text-amber-500" },
            ].map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                  <c.icon className={`h-4 w-4 ${c.color}`} />
                </div>
                <div className="text-3xl font-bold mt-2">{c.value.toLocaleString()}</div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "بحث..." : "Search..."}
              className="w-full ps-9 pe-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          {kind === "send" && (
            <>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">{lang === "ar" ? "كل القنوات" : "All channels"}</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="facebook">Facebook</option>
                <option value="system">System</option>
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">{lang === "ar" ? "كل الحالات" : "All statuses"}</option>
                <option value="sent">sent</option>
                <option value="delivered">delivered</option>
                <option value="failed">failed</option>
                <option value="pending">pending</option>
                <option value="queued">queued</option>
              </select>
            </>
          )}
          <button onClick={downloadCsv} disabled={!rows.length} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background text-sm hover:bg-muted disabled:opacity-40">
            <Download className="h-4 w-4" /> CSV
          </button>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-start">
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الوقت" : "Time"}</th>
                  <th className="px-4 py-3 font-semibold text-start">{kind === "send" ? (lang === "ar" ? "المستخدم" : "User") : (lang === "ar" ? "الأدمن" : "Admin")}</th>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الإجراء" : "Action"}</th>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "تفاصيل" : "Details"}</th>
                  {kind === "send" && <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الحالة" : "Status"}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">{lang === "ar" ? "لا توجد سجلات" : "No logs"}</td></tr>
                )}
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30 transition">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{(kind === "send" ? r.user?.full_name : r.admin?.full_name) ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{(kind === "send" ? r.user_id : r.admin_user_id)?.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-1 rounded bg-primary/10 text-primary text-xs font-mono">{r.action}</span>
                      {kind === "send" && <div className="text-xs text-muted-foreground mt-1">{r.channel}</div>}
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      {kind === "send" ? (
                        <>
                          <div className="font-medium truncate">{r.title}</div>
                          {r.recipient && <div className="text-xs text-muted-foreground truncate">→ {r.recipient}</div>}
                          {r.error_message && <div className="text-xs text-rose-500 mt-1 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span className="truncate">{r.error_message}</span></div>}
                        </>
                      ) : (
                        <>
                          {r.target?.full_name && <div className="text-xs">{lang === "ar" ? "الهدف:" : "Target:"} <span className="font-medium">{r.target.full_name}</span></div>}
                          {r.target_type && <div className="text-[10px] text-muted-foreground">{r.target_type}: {r.target_id}</div>}
                          {r.payload && Object.keys(r.payload).length > 0 && (
                            <details className="text-[10px] mt-1"><summary className="cursor-pointer text-muted-foreground">payload</summary><pre className="mt-1 p-2 rounded bg-muted/50 overflow-x-auto">{JSON.stringify(r.payload, null, 2)}</pre></details>
                          )}
                        </>
                      )}
                    </td>
                    {kind === "send" && (
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    failed: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    queued: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  };
  return <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${map[status] ?? "bg-muted text-muted-foreground"}`}>{status}</span>;
}

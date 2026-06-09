import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Search,
  Plus,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Upload,
  Pause,
  Play,
  CalendarClock,
  ListChecks,
  AlertCircle,
  FileSpreadsheet,
  Download,
  Sparkles,
  Megaphone,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/bulk")({
  ssr: false,
  component: BulkSendPage,
});

type Contact = Tables<"contacts">;
type BulkJob = Tables<"bulk_jobs">;

type Tab = "compose" | "contacts" | "jobs";

function BulkSendPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("compose");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Compose form
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [intervalSec, setIntervalSec] = useState(5);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduleAt, setScheduleAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Contact form
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);

  const t = lang === "ar"
    ? {
        title: "الإرسال الجماعي",
        subtitle: "أرسل رسائل واتساب لقوائمك مع فاصل زمني وجدولة في الخلفية",
        tabs: { compose: "إنشاء حملة", contacts: "جهات الاتصال", jobs: "المهام" },
        targets: "اختيار جهات الاستهداف",
        searchContacts: "ابحث بالاسم أو الرقم...",
        selectAll: "تحديد الكل",
        clearAll: "إلغاء التحديد",
        selected: "محدد",
        noContacts: "لا توجد جهات اتصال — أضف جهات أولاً من تبويب \"جهات الاتصال\"",
        addContact: "إضافة جهة اتصال",
        name: "الاسم",
        phone: "رقم الهاتف",
        phonePlaceholder: "مثال: 201001234567",
        add: "إضافة",
        delete: "حذف",
        compose: "نص الرسالة",
        msgPlaceholder: "اكتب الرسالة التي ستُرسل لكل جهة...",
        intervalLabel: "الفاصل الزمني بين كل إرسالين (ثوانٍ)",
        intervalHelp: "كلما زاد الفاصل قلّ احتمال حظر رقمك",
        scheduling: "وقت التشغيل",
        runNow: "تشغيل فوري",
        runLater: "جدولة لاحقاً",
        scheduledAt: "موعد التشغيل",
        launch: "إطلاق الحملة",
        launching: "جاري الإنشاء...",
        emptyMsg: "اكتب نص الرسالة",
        emptyTitle: "أضف عنواناً للحملة",
        noTargets: "حدد جهة اتصال واحدة على الأقل",
        characters: "حرف",
        jobs: "مهام الإرسال",
        noJobs: "لم تُنشأ أي حملة بعد",
        statuses: { scheduled: "مجدولة", running: "تعمل الآن", completed: "اكتملت", failed: "فشلت", cancelled: "ملغاة", paused: "متوقفة" } as Record<string, string>,
        sent: "أُرسلت",
        progress: "التقدم",
        cancel: "إلغاء الحملة",
        confirmCancel: "هل تريد إلغاء هذه الحملة؟ لن يكتمل الإرسال للمتبقّين.",
        cancelled: "تم الإلغاء",
        importHint: "أضف الأرقام يدوياً، أو ارفع ملف CSV / Excel، أو الصق قائمة جاهزة.",
        importPaste: "الصق أرقاماً (سطر لكل رقم بصيغة: الاسم,الرقم)",
        importBtn: "استيراد من النص",
        uploadTitle: "رفع ملف جهات اتصال",
        uploadDesc: "اسحب ملف CSV هنا أو اضغط للاختيار — يدعم Excel/CSV/TXT.",
        uploadBtn: "اختر ملف",
        uploadProcessing: "جاري المعالجة...",
        uploadFormat: "الصيغة المطلوبة: عمودان — الاسم في الأول والرقم في الثاني",
        downloadSample: "تحميل ملف نموذجي",
        importSuccess: (n: number) => `تم استيراد ${n} جهة اتصال`,
        importInvalid: "الملف فارغ أو غير صالح",
        of: "من",
        contactsCount: "جهات اتصال",
        bgInfo: "تعمل المهمة في الخلفية: المعالج يدور كل دقيقة ويرسل دفعات بحسب الفاصل الزمني الذي اخترته.",
      }
    : {
        title: "Bulk Send",
        subtitle: "Send WhatsApp messages to your lists with throttling and background scheduling",
        tabs: { compose: "New campaign", contacts: "Contacts", jobs: "Jobs" },
        targets: "Pick target contacts",
        searchContacts: "Search by name or number...",
        selectAll: "Select all",
        clearAll: "Clear",
        selected: "selected",
        noContacts: "No contacts yet — add contacts from the \"Contacts\" tab first",
        addContact: "Add contact",
        name: "Name",
        phone: "Phone",
        phonePlaceholder: "e.g. 201001234567",
        add: "Add",
        delete: "Delete",
        compose: "Message text",
        msgPlaceholder: "Type the message that will be sent to every contact...",
        intervalLabel: "Delay between sends (seconds)",
        intervalHelp: "A larger delay reduces the risk of your number getting banned",
        scheduling: "Run time",
        runNow: "Run immediately",
        runLater: "Schedule for later",
        scheduledAt: "Scheduled at",
        launch: "Launch campaign",
        launching: "Creating...",
        emptyMsg: "Write a message first",
        emptyTitle: "Give the campaign a title",
        noTargets: "Select at least one contact",
        characters: "characters",
        jobs: "Send jobs",
        noJobs: "No campaigns yet",
        statuses: { scheduled: "Scheduled", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", paused: "Paused" } as Record<string, string>,
        sent: "sent",
        progress: "Progress",
        cancel: "Cancel campaign",
        confirmCancel: "Cancel this campaign? Remaining sends will not be processed.",
        cancelled: "Cancelled",
        importHint: "Add numbers manually, upload a CSV/Excel file, or paste a list.",
        importPaste: "Paste lines (one per row, format: name,phone)",
        importBtn: "Import from text",
        uploadTitle: "Upload contacts file",
        uploadDesc: "Drag a CSV file here or click to choose — supports Excel/CSV/TXT.",
        uploadBtn: "Choose file",
        uploadProcessing: "Processing...",
        uploadFormat: "Required format: two columns — name in the first, phone in the second",
        downloadSample: "Download sample file",
        importSuccess: (n: number) => `Imported ${n} contacts`,
        importInvalid: "File is empty or invalid",
        of: "of",
        contactsCount: "contacts",
        bgInfo: "Jobs run in the background: the worker ticks every minute and sends batches respecting your interval.",
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  const loadAll = async () => {
    if (!user) return;
    const [{ data: c }, { data: j }] = await Promise.all([
      supabase.from("contacts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("bulk_jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    setContacts(c ?? []);
    setJobs(j ?? []);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [user]);

  // Realtime job + recipient updates
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`bulk-jobs-watch:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_jobs", filter: `user_id=eq.${user.id}` }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [contacts, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addContact = async () => {
    if (!user || !newName.trim() || !newPhone.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("contacts").insert({
      user_id: user.id,
      name: newName.trim(),
      phone: newPhone.trim(),
    });
    setAdding(false);
    if (error) { toast.error(error.message); return; }
    setNewName(""); setNewPhone("");
    toast.success(lang === "ar" ? "تمت الإضافة" : "Added");
    loadAll();
  };

  const deleteContact = async (id: string) => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    loadAll();
  };

  // Parse CSV/TXT line: handles "name","phone" with quotes, commas, tabs, semicolons.
  const parseRows = (text: string) => {
    if (!user) return [];
    const rows = text
      .replace(/^\uFEFF/, "") // strip BOM
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return rows
      .map((r, idx) => {
        // Strip quotes, split by , ; or tab
        const parts = r
          .split(/[,;\t]/)
          .map((s) => s.replace(/^["']|["']$/g, "").trim());
        let [name, phone] = parts;
        if (!name || !phone) return null;
        // Skip header row
        if (idx === 0 && /^(name|الاسم)$/i.test(name) && /^(phone|number|mobile|الرقم|الهاتف)$/i.test(phone)) {
          return null;
        }
        // Keep only digits + leading + in phone
        phone = phone.replace(/[^\d+]/g, "");
        if (phone.length < 6) return null;
        return { user_id: user.id, name, phone };
      })
      .filter(Boolean) as { user_id: string; name: string; phone: string }[];
  };

  const importFromText = async (text: string) => {
    const parsed = parseRows(text);
    if (parsed.length === 0) { toast.error(t.importInvalid); return; }
    const { error } = await supabase.from("contacts").insert(parsed);
    if (error) toast.error(error.message);
    else { toast.success(t.importSuccess(parsed.length)); loadAll(); }
  };

  const [uploading, setUploading] = useState(false);
  const importFromFile = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      await importFromText(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setUploading(false);
    }
  };

  const downloadSample = () => {
    const csv = "name,phone\nAhmed,201001234567\nMona,201112345678\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "contacts-sample.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const launchCampaign = async () => {
    if (!user) return;
    if (!title.trim()) { toast.error(t.emptyTitle); return; }
    if (!message.trim()) { toast.error(t.emptyMsg); return; }
    if (selected.size === 0) { toast.error(t.noTargets); return; }
    if (!scheduleNow && !scheduleAt) { toast.error(t.scheduledAt); return; }

    setSubmitting(true);
    try {
      const recipients = contacts.filter((c) => selected.has(c.id));
      const scheduledAt = scheduleNow ? new Date().toISOString() : new Date(scheduleAt).toISOString();
      const { data: job, error } = await supabase
        .from("bulk_jobs")
        .insert({
          user_id: user.id,
          channel: "bulk",
          title: title.trim(),
          message: message.trim(),
          interval_seconds: Math.max(1, Math.min(intervalSec, 3600)),
          scheduled_at: scheduledAt,
          status: "scheduled",
          total_recipients: recipients.length,
        })
        .select("*")
        .single();
      if (error || !job) throw new Error(error?.message ?? "Insert failed");

      const rows = recipients.map((r) => ({
        job_id: job.id,
        user_id: user.id,
        contact_id: r.id,
        name: r.name,
        phone: r.phone,
      }));
      const { error: rErr } = await supabase.from("bulk_job_recipients").insert(rows);
      if (rErr) throw new Error(rErr.message);

      toast.success(
        lang === "ar"
          ? `تم إنشاء الحملة (${recipients.length} مستلم)`
          : `Campaign created (${recipients.length} recipients)`,
      );
      // Reset compose
      setTitle(""); setMessage(""); setSelected(new Set()); setScheduleAt("");
      setTab("jobs");
      loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (id: string) => {
    if (!confirm(t.confirmCancel)) return;
    const { error } = await supabase.from("bulk_jobs").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t.cancelled); loadAll(); }
  };

  if (authLoading || !user) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="mx-auto max-w-6xl space-y-6">
        {/* Premium hero header */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary via-primary/70 to-primary/20" />
          <div className="absolute -end-12 -top-12 h-44 w-44 rounded-full bg-primary/15 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-lg shadow-primary/25">
                <Megaphone className="h-6 w-6" />
              </span>
              <div className="max-w-3xl">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  {lang === "ar" ? "حملات الإرسال" : "Bulk Campaigns"}
                </p>
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t.title}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{t.subtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <div className="rounded-xl border border-border bg-background/60 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t.contactsCount}</p>
                <p className="text-lg font-bold text-foreground">{contacts.length}</p>
              </div>
              <div className="rounded-xl border border-border bg-background/60 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{lang === "ar" ? "حملات" : "Campaigns"}</p>
                <p className="text-lg font-bold text-foreground">{jobs.length}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Background notice */}
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-foreground">{t.bgInfo}</p>
        </div>

        {/* Tabs — pill style */}
        <div className="inline-flex w-full max-w-xl rounded-2xl border border-border bg-muted/60 p-1.5 shadow-sm">
          {(["compose", "contacts", "jobs"] as const).map((k) => {
            const Icon = k === "compose" ? Send : k === "contacts" ? Users : ListChecks;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                  tab === k
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.tabs[k]}
              </button>
            );
          })}
        </div>

        {/* Compose tab */}
        {tab === "compose" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Targets */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{t.targets}</h3>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {selected.size} / {contacts.length}
                </span>
              </div>

              <div className={`relative mb-3`}>
                <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchContacts}
                  className={`w-full rounded-xl border border-border bg-background py-2 text-sm focus:border-primary focus:outline-none ${dir === "rtl" ? "pr-10 pl-3" : "pl-10 pr-3"}`}
                />
              </div>

              {contacts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
                  {t.noContacts}
                </div>
              ) : (
                <>
                  <div className="mb-2 flex gap-2">
                    <button onClick={() => setSelected(new Set(filtered.map((c) => c.id)))} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent">{t.selectAll}</button>
                    <button onClick={() => setSelected(new Set())} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent">{t.clearAll}</button>
                  </div>
                  <div className="max-h-80 space-y-1.5 overflow-y-auto">
                    {filtered.map((c) => {
                      const isSel = selected.has(c.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggle(c.id)}
                          className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-start transition-all ${
                            isSel ? "border-primary bg-primary/5" : "border-border bg-background/50 hover:border-primary/40"
                          }`}
                        >
                          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isSel ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            {isSel ? <CheckCircle2 className="h-4 w-4" /> : c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                            <p className="text-xs text-muted-foreground" dir="ltr">{c.phone}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Compose form */}
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{lang === "ar" ? "عنوان الحملة" : "Campaign title"}</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={lang === "ar" ? "مثلاً: عرض الجمعة" : "e.g. Friday offer"}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t.compose}</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.msgPlaceholder}
                  rows={6}
                  className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-end text-xs text-muted-foreground">{message.length} {t.characters}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t.intervalLabel}</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={120}
                    value={intervalSec}
                    onChange={(e) => setIntervalSec(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <input
                    type="number"
                    min={1}
                    max={3600}
                    value={intervalSec}
                    onChange={(e) => setIntervalSec(Number(e.target.value) || 1)}
                    className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm focus:border-primary focus:outline-none"
                  />
                  <span className="text-xs text-muted-foreground">s</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.intervalHelp}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t.scheduling}</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleNow(true)}
                    className={`flex-1 rounded-xl border p-3 text-sm font-medium transition-all ${scheduleNow ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    <Play className="mx-auto mb-1 h-4 w-4" />
                    {t.runNow}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleNow(false)}
                    className={`flex-1 rounded-xl border p-3 text-sm font-medium transition-all ${!scheduleNow ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
                  >
                    <Clock className="mx-auto mb-1 h-4 w-4" />
                    {t.runLater}
                  </button>
                </div>
                {!scheduleNow && (
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                )}
              </div>

              <button
                onClick={launchCampaign}
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? t.launching : t.launch}
              </button>
            </div>
          </div>
        )}

        {/* Contacts tab */}
        {tab === "contacts" && (
          <div className="space-y-6">
            {/* Hero: bulk upload — primary action */}
            <FileDropzone
              isAr={isAr}
              uploading={uploading}
              onFile={importFromFile}
              onSample={downloadSample}
              labels={{
                title: t.uploadTitle,
                desc: t.uploadDesc,
                btn: t.uploadBtn,
                processing: t.uploadProcessing,
                format: t.uploadFormat,
                sample: t.downloadSample,
              }}
            />

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Manual + paste */}
              <div className="space-y-5 rounded-2xl border border-border bg-card p-5 lg:col-span-1">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Plus className="h-4 w-4 text-primary" />
                    {t.addContact}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t.importHint}</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.name}</label>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.phone}</label>
                    <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder={t.phonePlaceholder} dir="ltr" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                  </div>
                  <button onClick={addContact} disabled={adding || !newName || !newPhone} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {t.add}
                  </button>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs font-semibold text-foreground">{t.importPaste}</p>
                  <BulkPaste onImport={importFromText} label={t.importBtn} />
                </div>
              </div>

              {/* Contacts list */}
              <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    {contacts.length} {t.contactsCount}
                  </h3>
                </div>
                {contacts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 p-10 text-center">
                    <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <p className="text-sm text-muted-foreground">{t.noContacts}</p>
                  </div>
                ) : (
                  <div className="max-h-[500px] space-y-1.5 overflow-y-auto pe-1">
                    {contacts.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-2.5 transition-colors hover:border-primary/40">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-sm font-bold text-primary">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">{c.phone}</p>
                        </div>
                        <button onClick={() => deleteContact(c.id)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Jobs tab */}
        {tab === "jobs" && (
          <div className="space-y-3">
            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
                <ListChecks className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t.noJobs}</p>
              </div>
            ) : (
              jobs.map((j) => {
                const pct = j.total_recipients > 0 ? Math.round(((j.sent_count + j.failed_count) / j.total_recipients) * 100) : 0;
                const statusClass =
                  j.status === "completed" ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : j.status === "running" ? "bg-primary/10 text-primary"
                  : j.status === "failed" ? "bg-destructive/10 text-destructive"
                  : j.status === "cancelled" ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400";
                return (
                  <div key={j.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-semibold text-foreground">{j.title}</h4>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                            {t.statuses[j.status] ?? j.status}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{j.message}</p>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {j.total_recipients}</span>
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {j.interval_seconds}s</span>
                          <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> {j.sent_count}</span>
                          <span className="inline-flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" /> {j.failed_count}</span>
                        </div>
                      </div>
                      {(j.status === "scheduled" || j.status === "running") && (
                        <button onClick={() => cancelJob(j.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">
                          <Pause className="h-3 w-3" /> {t.cancel}
                        </button>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>{t.progress}</span>
                        <span>{j.sent_count + j.failed_count} {t.of} {j.total_recipients} • {pct}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <Link to="/dashboard/activity" className="inline-block text-xs font-semibold text-primary hover:underline">
              {lang === "ar" ? "عرض السجل الكامل لكل الإرسالات →" : "View full activity log →"}
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function BulkPaste({ onImport, label }: { onImport: (t: string) => void; label: string }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"Ahmed,201001234567\nMona,201112345678"}
        className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs focus:border-primary focus:outline-none"
        dir="ltr"
      />
      <button
        onClick={() => { onImport(text); setText(""); }}
        disabled={!text.trim()}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Upload className="h-3 w-3" /> {label}
      </button>
    </div>
  );
}

// Suppress unused-icon warnings for icons used conditionally
void AlertCircle;
void Sparkles;

function FileDropzone({
  isAr,
  uploading,
  onFile,
  onSample,
  labels,
}: {
  isAr: boolean;
  uploading: boolean;
  onFile: (f: File) => void;
  onSample: () => void;
  labels: { title: string; desc: string; btn: string; processing: string; format: string; sample: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-6 transition-all sm:p-8 ${
        dragOver
          ? "border-primary bg-primary/10"
          : "border-border bg-gradient-to-br from-primary/5 via-card to-card hover:border-primary/40"
      }`}
    >
      <div className="absolute -end-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-start">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-lg shadow-primary/25">
          {uploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <FileSpreadsheet className="h-7 w-7" />}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground sm:text-lg">{labels.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{labels.desc}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">{labels.format}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition hover:opacity-90 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? labels.processing : labels.btn}
          </button>
          <button
            type="button"
            onClick={onSample}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-accent"
          >
            <Download className="h-3.5 w-3.5" />
            {labels.sample}
          </button>
        </div>
      </div>
      {isAr ? null : null}
    </div>
  );
}

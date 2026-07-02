import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { sendWaMessage } from "@/lib/wa.functions";

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
  FileSpreadsheet,
  Download,
  Megaphone,
  Image as ImageIcon,
  X,
  FolderOpen,
  Tag,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { statusBadgeTone } from "@/lib/status-badge";
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

type Tab = "compose" | "lists" | "jobs";

const UNTAGGED = "__untagged__";

function BulkSendPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const isAr = lang === "ar";
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("compose");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<BulkJob[]>([]);

  // Compose form
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [intervalSec, setIntervalSec] = useState(30);
  const [batchSize, setBatchSize] = useState(10);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduleAt, setScheduleAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const sendWaMessageFn = useServerFn(sendWaMessage);

  const [pickedList, setPickedList] = useState<string | null>(null);
  const [extraContactIds, setExtraContactIds] = useState<Set<string>>(new Set());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  // Lists tab
  const [listName, setListName] = useState("");
  const [search, setSearch] = useState("");
  const [openListView, setOpenListView] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`bulk-jobs-watch:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_jobs", filter: `user_id=eq.${user.id}` }, loadAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user]);

  // Build named lists from contacts.tags
  const lists = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      const tags = (c.tags && c.tags.length ? c.tags : [UNTAGGED]) as string[];
      for (const t of tags) {
        if (!map.has(t)) map.set(t, []);
        map.get(t)!.push(c);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] === UNTAGGED ? 1 : b[0] === UNTAGGED ? -1 : a[0].localeCompare(b[0])));
  }, [contacts]);

  const selectedRecipients = useMemo(() => {
    if (!pickedList) return contacts.filter((c) => extraContactIds.has(c.id));
    const inList = contacts.filter((c) => {
      const tags = (c.tags && c.tags.length ? c.tags : [UNTAGGED]) as string[];
      return tags.includes(pickedList);
    });
    const extras = contacts.filter((c) => extraContactIds.has(c.id) && !inList.find((x) => x.id === c.id));
    return [...inList, ...extras];
  }, [contacts, pickedList, extraContactIds]);

  // ---- CSV parse ----
  const parseRows = (text: string, tag: string | null) => {
    if (!user) return [];
    const rows = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return rows
      .map((r, idx) => {
        const parts = r.split(/[,;\t]/).map((s) => s.replace(/^["']|["']$/g, "").trim());
        let [name, phone] = parts;
        if (!phone && name && /\d{6,}/.test(name)) {
          // single column = phone only
          phone = name; name = "—";
        }
        if (!name || !phone) return null;
        if (idx === 0 && /^(name|الاسم)$/i.test(name) && /^(phone|number|mobile|الرقم|الهاتف)$/i.test(phone)) return null;
        phone = phone.replace(/[^\d+]/g, "");
        if (phone.length < 6) return null;
        return { user_id: user.id, name, phone, tags: tag ? [tag] : null };
      })
      .filter(Boolean) as { user_id: string; name: string; phone: string; tags: string[] | null }[];
  };

  const importFromFile = async (file: File, tag: string) => {
    if (!tag.trim()) {
      toast.error(isAr ? "أدخل اسم القائمة أولاً" : "Enter list name first");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseRows(text, tag.trim());
      if (parsed.length === 0) {
        toast.error(isAr ? "الملف فارغ أو غير صالح" : "File is empty or invalid");
        return;
      }
      const { error } = await supabase.from("contacts").insert(parsed);
      if (error) { toast.error(error.message); return; }
      toast.success(isAr ? `تم استيراد ${parsed.length} رقم في قائمة "${tag}"` : `Imported ${parsed.length} into "${tag}"`);
      setListName("");
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const downloadSample = () => {
    const csv = "name,phone\nAhmed,201001234567\nMona,201112345678\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "list-sample.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const deleteList = async (tag: string) => {
    if (!user) return;
    if (!confirm(isAr ? `حذف قائمة "${tag}" بكل أرقامها؟` : `Delete list "${tag}" and all its contacts?`)) return;
    const ids = contacts.filter((c) => (c.tags ?? []).includes(tag)).map((c) => c.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("contacts").delete().in("id", ids);
    if (error) toast.error(error.message);
    else { toast.success(isAr ? "تم الحذف" : "Deleted"); loadAll(); if (pickedList === tag) setPickedList(null); }
  };

  const deleteContact = async (id: string) => {
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setExtraContactIds((p) => { const n = new Set(p); n.delete(id); return n; });
    loadAll();
  };

  // ---- Image upload ----
  const uploadImage = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      toast.error(isAr ? "اختر ملف صورة" : "Choose an image file");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(isAr ? "الحجم الأقصى 8MB" : "Max 8MB");
      return;
    }
    setImageUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("bulk-media").upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed, error: sErr } = await supabase.storage.from("bulk-media").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (sErr || !signed) throw sErr ?? new Error("sign failed");
      setImageUrl(signed.signedUrl);
      toast.success(isAr ? "تم رفع الصورة" : "Image uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setImageUploading(false);
    }
  };

  const ensureWaConnected = async (): Promise<boolean> => {
    if (!user) return false;
    const { data, error } = await supabase
      .from("wa_sessions")
      .select("status")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return false;
    }
    const status = data?.status ?? null;
    if (status !== "connected") {
      const msg = isAr
        ? "لا يمكن بدء الحملة: جلسة واتساب غير متصلة. سيتم تحويلك لإعادة الاقتران."
        : "Cannot start campaign: WhatsApp session is not connected. Redirecting to reconnect.";
      toast.error(msg);
      setTimeout(() => {
        navigate({ to: "/dashboard/whatsapp/accounts" });
      }, 1200);
      return false;
    }
    return true;
  };

  const sendSessionTest = async () => {
    const raw = testPhone.trim().replace(/[^0-9+]/g, "");
    if (raw.length < 8) {
      toast.error(isAr ? "أدخل رقماً صحيحاً بصيغة دولية (مثال: 201234567890)" : "Enter a valid international number (e.g., 201234567890)");
      return;
    }
    if (!(await ensureWaConnected())) return;
    setTestSending(true);
    const stamp = new Date().toLocaleTimeString();
    try {
      await sendWaMessageFn({
        data: {
          to: raw,
          text: (isAr ? `✅ رسالة اختبار من Flowtix — الجلسة تعمل بنجاح (${stamp})` : `✅ Flowtix test — session is working (${stamp})`),
        },
      });
      toast.success(isAr ? "تم إرسال رسالة الاختبار — تحقق من واتساب المستلم" : "Test message sent — check the recipient's WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (isAr ? "فشل الإرسال" : "Send failed"));
    } finally {
      setTestSending(false);
    }
  };



  const MESSAGE_MAX = 4000;

  const launchCampaign = async () => {
    if (!user) return;
    if (!title.trim()) { toast.error(isAr ? "أضف عنواناً للحملة" : "Add a title"); return; }
    // Message is REQUIRED; image is optional
    if (!message.trim()) { toast.error(isAr ? "نص الرسالة مطلوب" : "Message text is required"); return; }
    if (message.length > MESSAGE_MAX) {
      toast.error(isAr ? `الرسالة تتجاوز الحد الأقصى (${MESSAGE_MAX} حرف)` : `Message exceeds the ${MESSAGE_MAX}-char limit`);
      return;
    }
    if (imageUrl) {
      const ok = window.confirm(
        isAr
          ? `سيتم إرسال رسالتين لكل عميل:\n\n1) النص:\n${message.trim().slice(0, 120)}${message.trim().length > 120 ? "…" : ""}\n\n2) الصورة المرفقة\n\nهل تريد المتابعة؟`
          : `Each contact will receive TWO messages:\n\n1) Text:\n${message.trim().slice(0, 120)}${message.trim().length > 120 ? "…" : ""}\n\n2) The attached image\n\nContinue?`
      );
      if (!ok) return;
    }
    if (selectedRecipients.length === 0) { toast.error(isAr ? "اختر قائمة أو جهة اتصال" : "Pick a list or contacts"); return; }
    if (!scheduleNow && !scheduleAt) { toast.error(isAr ? "حدد موعد التشغيل" : "Pick a schedule"); return; }
    if (!(await ensureWaConnected())) return;



    setSubmitting(true);
    try {

      const scheduledAt = scheduleNow ? new Date().toISOString() : new Date(scheduleAt).toISOString();
      const { data: job, error } = await supabase
        .from("bulk_jobs")
        .insert({
          user_id: user.id,
          channel: "bulk",
          title: title.trim(),
          message: message.trim(),
          image_url: imageUrl,
          interval_seconds: Math.max(1, Math.min(intervalSec, 3600)),
          batch_size: Math.max(1, Math.min(batchSize, 100)),
          scheduled_at: scheduledAt,
          status: "scheduled",
          total_recipients: selectedRecipients.length,
          metadata: { list_name: pickedList, has_image: !!imageUrl },
        })
        .select("*")
        .single();
      if (error || !job) throw new Error(error?.message ?? "Insert failed");

      const rows = selectedRecipients.map((r) => ({
        job_id: job.id,
        user_id: user.id,
        contact_id: r.id,
        name: r.name,
        phone: r.phone,
      }));
      const { error: rErr } = await supabase.from("bulk_job_recipients").insert(rows);
      if (rErr) throw new Error(rErr.message);

      toast.success(isAr ? `تم إنشاء الحملة (${selectedRecipients.length} مستلم)` : `Campaign created (${selectedRecipients.length} recipients)`);
      setTitle(""); setMessage(""); setScheduleAt(""); setImageUrl(null);
      setPickedList(null); setExtraContactIds(new Set());
      setTab("jobs");
      loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (id: string) => {
    if (!confirm(isAr ? "إلغاء هذه الحملة؟" : "Cancel this campaign?")) return;
    const { error } = await supabase.from("bulk_jobs").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(isAr ? "تم الإلغاء" : "Cancelled"); loadAll(); }
  };

  const resumeJobCore = async (id: string) => {
    const { error: rErr } = await supabase
      .from("bulk_job_recipients")
      .update({ status: "pending", error_message: null, sent_at: null })
      .eq("job_id", id)
      .eq("status", "failed");
    if (rErr) throw new Error(rErr.message);
    const { error: jErr } = await supabase
      .from("bulk_jobs")
      .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
      .eq("id", id);
    if (jErr) throw new Error(jErr.message);
  };

  const resumeJob = async (id: string) => {
    if (!confirm(isAr ? "استئناف الحملة الآن؟ سيتم إعادة إرسال الأرقام التي فشلت." : "Resume campaign now? Failed recipients will be retried.")) return;
    if (!(await ensureWaConnected())) return;
    try {
      await resumeJobCore(id);
      toast.success(isAr ? "تم استئناف الحملة — سيتم البدء خلال دقيقة" : "Campaign resumed — will start within a minute");
      loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const pendingJobIds = useMemo(
    () => jobs.filter((j) => j.status === "paused" || j.status === "cancelled" || j.status === "failed").map((j) => j.id),
    [jobs],
  );

  const resumeAllPending = async (opts?: { silent?: boolean; skipConnectionCheck?: boolean }) => {
    const ids = pendingJobIds;
    if (ids.length === 0) {
      if (!opts?.silent) toast.info(isAr ? "لا توجد حملات معلقة" : "No pending campaigns");
      return 0;
    }
    if (!opts?.skipConnectionCheck && !(await ensureWaConnected())) return 0;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try { await resumeJobCore(id); ok += 1; } catch { fail += 1; }
    }
    if (ok > 0) {
      toast.success(isAr ? `تم استئناف ${ok} حملة${fail ? ` (فشل ${fail})` : ""}` : `Resumed ${ok} campaign(s)${fail ? ` (${fail} failed)` : ""}`);
    } else if (fail > 0) {
      toast.error(isAr ? `فشل استئناف ${fail} حملة` : `Failed to resume ${fail} campaign(s)`);
    }
    loadAll();
    return ok;
  };

  // Auto-resume: watch wa_sessions; when status flips to "connected", resume pending campaigns.
  const lastWaStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from("wa_sessions")
        .select("status,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const status = data?.status ?? null;
      const prev = lastWaStatusRef.current;
      lastWaStatusRef.current = status;
      if (prev && prev !== "connected" && status === "connected") {
        const pending = jobs.filter((j) => j.status === "paused" || j.status === "cancelled" || j.status === "failed");
        if (pending.length > 0) {
          toast.success(isAr ? `تم استعادة الاتصال — جارٍ استئناف ${pending.length} حملة تلقائياً` : `Connection restored — auto-resuming ${pending.length} campaign(s)`);
          await resumeAllPending({ silent: true, skipConnectionCheck: true });
        }
      }
    };
    check();
    const ch = supabase
      .channel(`wa-sessions-watch:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_sessions", filter: `user_id=eq.${user.id}` }, () => { check(); })
      .subscribe();
    const iv = setInterval(check, 20_000);
    return () => { cancelled = true; supabase.removeChannel(ch); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, jobs]);



  if (authLoading || !user) return null;

  const statusLabels: Record<string, string> = isAr
    ? { scheduled: "مجدولة", running: "تعمل الآن", completed: "اكتملت", failed: "فشلت", cancelled: "ملغاة", paused: "متوقفة" }
    : { scheduled: "Scheduled", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", paused: "Paused" };

  return (
    <DashboardLayout title={isAr ? "الإرسال الجماعي" : "Bulk Send"}>
      <div dir={dir} className="mx-auto max-w-6xl space-y-6">
        {/* Hero */}
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
                  {isAr ? "حملات الإرسال" : "Bulk Campaigns"}
                </p>
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{isAr ? "الإرسال الجماعي" : "Bulk Send"}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                  {isAr
                    ? "ارفع قوائم أرقام بأسماء (قائمة 1، قائمة 2...)، اختر قائمة وأرسل لها نص أو صورة بفاصل زمني آمن."
                    : "Upload named contact lists, pick one, and send a message or image with safe throttling."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <Stat label={isAr ? "قوائم" : "Lists"} value={lists.filter((l) => l[0] !== UNTAGGED).length} />
              <Stat label={isAr ? "أرقام" : "Contacts"} value={contacts.length} />
              <Stat label={isAr ? "حملات" : "Campaigns"} value={jobs.length} />
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="inline-flex w-full max-w-xl rounded-2xl border border-border bg-muted/60 p-1.5 shadow-sm">
          {(["compose", "lists", "jobs"] as const).map((k) => {
            const Icon = k === "compose" ? Send : k === "lists" ? FolderOpen : ListChecks;
            const label = k === "compose" ? (isAr ? "إنشاء حملة" : "New campaign")
              : k === "lists" ? (isAr ? "القوائم" : "Lists")
              : (isAr ? "المهام" : "Jobs");
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                  tab === k ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>

        {/* ============================ COMPOSE ============================ */}
        {tab === "compose" && (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* List picker (left) */}
            <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  <Tag className="h-4 w-4 text-primary" />
                  {isAr ? "اختر قائمة الاستهداف" : "Pick a target list"}
                </h3>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                  {selectedRecipients.length} {isAr ? "مستلم" : "to send"}
                </span>
              </div>

              {lists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
                  {isAr ? "لا توجد قوائم — أنشئ قائمة من تبويب \"القوائم\"" : "No lists — create one from the Lists tab"}
                  <div className="mt-3">
                    <button onClick={() => setTab("lists")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
                      {isAr ? "إنشاء قائمة" : "Create list"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {lists.map(([name, items]) => {
                    const isPicked = pickedList === name;
                    const display = name === UNTAGGED ? (isAr ? "(بدون قائمة)" : "(no list)") : name;
                    return (
                      <button
                        key={name}
                        onClick={() => setPickedList(isPicked ? null : name)}
                        className={`flex w-full items-center justify-between rounded-xl border p-3 text-start transition-all ${
                          isPicked ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border bg-background/50 hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${
                            isPicked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          }`}>
                            {isPicked ? <CheckCircle2 className="h-5 w-5" /> : <FolderOpen className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{display}</p>
                            <p className="text-xs text-muted-foreground">{items.length} {isAr ? "رقم" : "contacts"}</p>
                          </div>
                        </div>
                        {isPicked && <Play className="h-4 w-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {pickedList && (
                <p className="mt-3 rounded-lg bg-emerald-500/10 p-2 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {isAr
                    ? `سيتم الإرسال إلى ${selectedRecipients.length} رقم من قائمة "${pickedList === UNTAGGED ? "بدون" : pickedList}"`
                    : `Will send to ${selectedRecipients.length} contacts in "${pickedList === UNTAGGED ? "no list" : pickedList}"`}
                </p>
              )}
            </div>

            {/* Compose form (right) */}
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:col-span-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{isAr ? "عنوان الحملة" : "Campaign title"}</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isAr ? "مثلاً: عرض الجمعة" : "e.g. Friday offer"}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                  <span>{isAr ? "نص الرسالة" : "Message text"}</span>
                  <span className="text-destructive" aria-label="required">*</span>
                  <span className="ms-1 rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
                    {isAr ? "مطلوب" : "required"}
                  </span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                  placeholder={isAr ? "اكتب الرسالة... (مطلوب)" : "Type the message... (required)"}
                  rows={5}
                  maxLength={MESSAGE_MAX}
                  required
                  aria-required="true"
                  className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
                />
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{isAr ? "متغيرات مسموحة: {{name}}, {{phone}}" : "Placeholders: {{name}}, {{phone}}"}</span>
                  <span className={message.length > MESSAGE_MAX * 0.9 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                    {message.length} / {MESSAGE_MAX} {isAr ? "حرف" : "chars"}
                  </span>
                </div>
              </div>

              {/* Image attach */}
              <div>
                <label className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
                  <span>{isAr ? "إرفاق صورة" : "Attach image"}</span>
                  <span className="ms-1 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">
                    {isAr ? "اختياري" : "optional"}
                  </span>
                </label>

                {imageUrl ? (
                  <div className="relative inline-block rounded-xl border border-border bg-background p-2">
                    <img src={imageUrl} alt="attached" className="h-32 w-auto rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageUrl(null)}
                      className="absolute -end-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-destructive text-destructive-foreground shadow"
                      title={isAr ? "إزالة" : "Remove"}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-border bg-background/60 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary">
                    {imageUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                    {imageUploading ? (isAr ? "جاري الرفع..." : "Uploading...") : (isAr ? "اختر صورة (≤ 8MB)" : "Choose image (≤ 8MB)")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={imageUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }}
                    />
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{isAr ? "أرقام كل دفعة" : "Per batch"}</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={1} max={50} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className="flex-1 accent-primary" />
                    <input type="number" min={1} max={100} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value) || 1)} className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm focus:border-primary focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{isAr ? "ثواني بين الدفعات" : "Seconds between batches"}</label>
                  <div className="flex items-center gap-3">
                    <input type="range" min={5} max={300} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="flex-1 accent-primary" />
                    <input type="number" min={1} max={3600} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value) || 1)} className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm focus:border-primary focus:outline-none" />
                    <span className="text-xs text-muted-foreground">s</span>
                  </div>
                </div>
              </div>
              <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                {isAr ? "موصى به: 10 أرقام كل 30 ثانية لتجنّب الحظر." : "Recommended: 10 numbers every 30s to avoid bans."}
              </p>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">{isAr ? "وقت التشغيل" : "Run time"}</label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setScheduleNow(true)} className={`flex-1 rounded-xl border p-3 text-sm font-medium transition-all ${scheduleNow ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                    <Play className="mx-auto mb-1 h-4 w-4" />
                    {isAr ? "تشغيل فوري" : "Run now"}
                  </button>
                  <button type="button" onClick={() => setScheduleNow(false)} className={`flex-1 rounded-xl border p-3 text-sm font-medium transition-all ${!scheduleNow ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                    <Clock className="mx-auto mb-1 h-4 w-4" />
                    {isAr ? "جدولة لاحقاً" : "Schedule later"}
                  </button>
                </div>
                {!scheduleNow && (
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
                )}
              </div>

              <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
                <p className="mb-2 text-xs font-semibold text-foreground">
                  {isAr ? "اختبر الجلسة قبل الإطلاق" : "Test the session before launch"}
                </p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {isAr ? "أرسل رسالة تجريبية لرقمك للتأكد أن الجلسة تعمل." : "Send a test message to your own number to verify the session."}
                </p>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder={isAr ? "رقم دولي، مثال: 201234567890" : "Intl. number, e.g., 201234567890"}
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={sendSessionTest}
                    disabled={testSending}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-60"
                  >
                    {testSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    {testSending ? (isAr ? "جارٍ..." : "Sending…") : (isAr ? "اختبار" : "Test")}
                  </button>
                </div>
              </div>

              {/* Preview: mirrors exactly what the server sends (renderTemplate + send order) */}
              {(() => {
                // Match server: replace {{name}} / {{phone}} then trim
                const sample = selectedRecipients[0];
                const sampleName = sample?.name?.trim() || (isAr ? "أحمد" : "Ahmed");
                const samplePhone = sample?.phone?.trim() || "201000000000";
                const rendered = message
                  .replace(/\{\{?\s*name\s*\}?\}/gi, sampleName)
                  .replace(/\{\{?\s*phone\s*\}?\}/gi, samplePhone)
                  .trim();
                const nowLabel = new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" });
                if (!rendered && !imageUrl) return null;
                return (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">✓</span>
                        {isAr ? "معاينة مطابقة لما سيصل للعميل" : "Exact preview of what the customer receives"}
                      </p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {isAr ? `عينة: ${sampleName}` : `Sample: ${sampleName}`}
                      </span>
                    </div>
                    <div
                      className="space-y-2 rounded-lg p-3"
                      style={{
                        backgroundColor: "#e5ddd5",
                        backgroundImage:
                          "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4) 0, transparent 40%), radial-gradient(circle at 80% 60%, rgba(0,0,0,0.03) 0, transparent 40%)",
                      }}
                      dir="auto"
                    >
                      {/* 1) TEXT bubble first — exactly as server sends via sendText */}
                      {rendered && (
                        <div className="flex justify-end">
                          <div className="relative max-w-[85%] rounded-lg bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-gray-900 shadow-sm" dir="auto">
                            <p className="whitespace-pre-wrap break-words">{rendered}</p>
                            <span className="mt-1 block text-end text-[10px] text-gray-500">{nowLabel} ✓✓</span>
                          </div>
                        </div>
                      )}
                      {/* 2) IMAGE bubble second — no caption, matches sendMedia */}
                      {imageUrl && (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-lg bg-[#dcf8c6] p-1 shadow-sm">
                            <img src={imageUrl} alt="preview" className="max-h-56 w-auto rounded-md object-cover" />
                            <span className="mt-1 block px-2 pb-1 text-end text-[10px] text-gray-500">{nowLabel} ✓✓</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <li>• {isAr ? "الترتيب: النص أولاً ثم الصورة كرسالتين منفصلتين." : "Order: text first, then image, as two separate messages."}</li>
                      <li>• {isAr ? "المتغيرات {{name}} و {{phone}} تُستبدل ببيانات كل مستلم." : "Placeholders {{name}} and {{phone}} are replaced per recipient."}</li>
                      {imageUrl && <li>• {isAr ? "الصورة تُرسل بدون تعليق (caption) — النص في الرسالة الأولى." : "The image is sent without a caption — text goes in message #1."}</li>}
                    </ul>
                  </div>
                );
              })()}



              <button


                onClick={launchCampaign}
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? (isAr ? "جاري الإنشاء..." : "Creating...") : (isAr ? "إطلاق الحملة" : "Launch campaign")}
              </button>
            </div>
          </div>
        )}

        {/* ============================ LISTS ============================ */}
        {tab === "lists" && (
          <div className="space-y-6">
            <UploadListCard
              isAr={isAr}
              listName={listName}
              setListName={setListName}
              onFile={(f) => importFromFile(f, listName)}
              onSample={downloadSample}
            />

            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <FolderOpen className="h-4 w-4 text-primary" />
                  {isAr ? "قوائمك" : "Your lists"}
                </h3>
                <div className="relative">
                  <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? "ابحث..." : "Search..."}
                    className={`rounded-lg border border-border bg-background py-1.5 text-sm focus:border-primary focus:outline-none ${dir === "rtl" ? "pr-9 pl-3" : "pl-9 pr-3"}`} />
                </div>
              </div>

              {lists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background/40 p-10 text-center">
                  <FolderOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">{isAr ? "لا توجد قوائم بعد — ارفع ملفك الأول بالأعلى" : "No lists yet — upload your first file above"}</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lists
                    .filter(([name]) => !search || name.toLowerCase().includes(search.toLowerCase()))
                    .map(([name, items]) => {
                      const display = name === UNTAGGED ? (isAr ? "بدون قائمة" : "No list") : name;
                      return (
                        <div key={name} className="group rounded-xl border border-border bg-background/60 p-4 transition-colors hover:border-primary/40">
                          <div className="flex items-start justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-foreground">{display}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{items.length} {isAr ? "رقم" : "contacts"}</p>
                            </div>
                            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                              <Users className="h-4 w-4" />
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => setOpenListView(name)} className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:bg-accent">
                              {isAr ? "عرض" : "View"}
                            </button>
                            <button onClick={() => { setPickedList(name); setTab("compose"); }} className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
                              {isAr ? "إرسال" : "Send"}
                            </button>
                            {name !== UNTAGGED && (
                              <button onClick={() => deleteList(name)} className="rounded-lg border border-border px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* List drawer */}
            {openListView && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpenListView(null)}>
                <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()} dir={dir}>
                  <div className="flex items-center justify-between border-b border-border p-4">
                    <h3 className="font-bold text-foreground">
                      {openListView === UNTAGGED ? (isAr ? "بدون قائمة" : "No list") : openListView}
                    </h3>
                    <button onClick={() => setOpenListView(null)} className="rounded-lg p-1.5 hover:bg-accent">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-[60vh] space-y-1 overflow-y-auto p-3">
                    {contacts
                      .filter((c) => (c.tags && c.tags.length ? c.tags : [UNTAGGED]).includes(openListView))
                      .map((c) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-2">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{c.name}</p>
                            <p className="text-xs text-muted-foreground" dir="ltr">{c.phone}</p>
                          </div>
                          <button onClick={() => deleteContact(c.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================ JOBS ============================ */}
        {tab === "jobs" && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="flex-1 text-foreground">
                {isAr
                  ? "تعمل المهمة في الخلفية: المعالج يدور كل دقيقة ويرسل دفعات بحسب الفاصل الزمني الذي اخترته. يتم استئناف الحملات المعلقة تلقائياً بمجرد اتصال واتساب."
                  : "Jobs run in the background. Paused/failed campaigns auto-resume as soon as WhatsApp reconnects."}
              </p>
              {pendingJobIds.length > 0 && (
                <button
                  onClick={() => resumeAllPending()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                >
                  <Play className="h-3 w-3" /> {isAr ? `استئناف الكل (${pendingJobIds.length})` : `Resume all (${pendingJobIds.length})`}
                </button>
              )}
            </div>

            {jobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
                <ListChecks className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{isAr ? "لم تُنشأ أي حملة بعد" : "No campaigns yet"}</p>
              </div>
            ) : (
              jobs.map((j) => {
                const pct = j.total_recipients > 0 ? Math.round(((j.sent_count + j.failed_count) / j.total_recipients) * 100) : 0;
                const statusClass = statusBadgeTone(j.status).tone;
                return (
                  <div key={j.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-semibold text-foreground">{j.title}</h4>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                            {statusLabels[j.status] ?? j.status}
                          </span>
                          {j.image_url && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              <ImageIcon className="h-3 w-3" /> {isAr ? "صورة" : "Image"}
                            </span>
                          )}
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
                          <Pause className="h-3 w-3" /> {isAr ? "إلغاء" : "Cancel"}
                        </button>
                      )}
                      {(j.status === "cancelled" || j.status === "paused" || j.status === "failed") && (
                        <button onClick={() => resumeJob(j.id)} className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20">
                          <Play className="h-3 w-3" /> {isAr ? "استئناف" : "Resume"}
                        </button>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>{isAr ? "التقدم" : "Progress"}</span>
                        <span>{j.sent_count + j.failed_count} {isAr ? "من" : "of"} {j.total_recipients} • {pct}%</span>
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
              {isAr ? "عرض السجل الكامل لكل الإرسالات →" : "View full activity log →"}
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function UploadListCard({
  isAr,
  listName,
  setListName,
  onFile,
  onSample,
}: {
  isAr: boolean;
  listName: string;
  setListName: (v: string) => void;
  onFile: (f: File) => void;
  onSample: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-lg shadow-primary/25">
          <FileSpreadsheet className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">{isAr ? "رفع قائمة جديدة" : "Upload a new list"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "اكتب اسم القائمة (مثل: قائمة 1، عملاء القاهرة)، ثم ارفع ملف CSV يحتوي عمودين: الاسم، الرقم."
              : "Name your list (e.g. List 1, Cairo customers), then upload a CSV with two columns: name, phone."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">{isAr ? "اسم القائمة" : "List name"}</label>
          <input
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder={isAr ? "مثلاً: قائمة 1" : "e.g. List 1"}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onSample}
          className="inline-flex items-end justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent self-end"
        >
          <Download className="h-3.5 w-3.5" />
          {isAr ? "ملف نموذجي" : "Sample"}
        </button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          if (!listName.trim()) { toast.error(isAr ? "أدخل اسم القائمة أولاً" : "Enter list name first"); return; }
          setUploading(true); await onFile(f); setUploading(false);
        }}
        className={`mt-3 rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
          dragOver ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/40"
        }`}
      >
        <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-foreground">
          {isAr ? "اسحب الملف هنا أو" : "Drag a file here or"}{" "}
          <button
            type="button"
            onClick={() => {
              if (!listName.trim()) { toast.error(isAr ? "أدخل اسم القائمة أولاً" : "Enter list name first"); return; }
              inputRef.current?.click();
            }}
            className="font-bold text-primary underline-offset-2 hover:underline"
          >
            {isAr ? "اختر ملفاً" : "browse"}
          </button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{isAr ? "يدعم CSV / TXT / TSV (≤ 50,000 رقم)" : "CSV / TXT / TSV (≤ 50,000 rows)"}</p>
        {uploading && <p className="mt-2 inline-flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> {isAr ? "جاري المعالجة..." : "Processing..."}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) { setUploading(true); await onFile(f); setUploading(false); }
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Users,
  Loader2,
  AlertCircle,
  Tag,
  ChevronLeft,
  ChevronRight,
  Cookie,
  X,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listMessengerPages,
  listMessengerContacts,
  getMessengerSyncStatus,
  startMessengerSync,
  sendMessengerBroadcast,
  updateMessengerContactTags,
} from "@/lib/messenger-contacts.functions";
import { createExtractPagesJob, getJob, listBotAccounts, listJobs } from "@/lib/fb-bot.functions";

export const Route = createFileRoute("/dashboard/facebook/messenger-contacts")({
  ssr: false,
  component: MessengerContactsPage,
});

const MESSAGE_TAGS = [
  "HUMAN_AGENT",
  "CONFIRMED_EVENT_UPDATE",
  "POST_PURCHASE_UPDATE",
  "ACCOUNT_UPDATE",
] as const;

type Contact = {
  id: string;
  page_id: string;
  page_name: string | null;
  psid: string;
  full_name: string | null;
  profile_pic_url: string | null;
  last_message_at: string | null;
  first_message_at: string | null;
  messages_count: number;
  last_direction: "in" | "out" | null;
  last_message_preview: string | null;
  tags: string[];
};

type BotAccount = {
  id: string;
  display_name: string;
  status: "untested" | "active" | "invalid" | "checkpoint" | "disabled";
  last_error: string | null;
};

type FbJob = {
  id: string;
  job_type: string;
  status: string;
  progress: number | null;
  total_items: number | null;
  processed_items: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  account_id: string | null;
};

type JobResult = {
  id: string;
  target: string | null;
  status: string;
  data: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
};

type ExtractLogRow = {
  id: string;
  created_at: string;
  data: Record<string, unknown>;
};

function compactText(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function formatDuration(ms: unknown, lang: "ar" | "en") {
  const n = typeof ms === "number" ? ms : Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1000) return lang === "ar" ? `${Math.round(n)} مللي ثانية` : `${Math.round(n)}ms`;
  return lang === "ar" ? `${(n / 1000).toFixed(1)} ثانية` : `${(n / 1000).toFixed(1)}s`;
}

function formatExtractPagesLog(row: ExtractLogRow, lang: "ar" | "en") {
  const d = row.data;
  const event = compactText(d.event);
  const stage = compactText(d.stage);
  const surface = compactText(d.surface);
  const duration = formatDuration(d.duration_ms, lang);
  const count = d.collectedCount ?? d.discoveredOnSurface ?? d.renderedCount ?? d.bootCount;
  const label = lang === "ar";

  if (event === "worker_claimed") return label ? "استلم الوركر المهمة من قائمة الانتظار." : "Worker claimed the job.";
  if (event === "login_verified") return label ? "تم تأكيد جلسة فيسبوك بنجاح." : "Facebook session verified.";
  if (event === "surface_started") return label ? `بدء فتح مسار فيسبوك: ${surface}` : `Opening Facebook surface: ${surface}`;
  if (event === "surface_open_failed") return label ? `فشل فتح المسار: ${compactText(d.error)}` : `Surface open failed: ${compactText(d.error)}`;
  if (event === "surface_finished") {
    return label
      ? `تم فحص المسار: ${d.discoveredOnSurface ?? 0} صفحة جديدة، الإجمالي ${d.collectedCount ?? 0}.`
      : `Surface scanned: ${d.discoveredOnSurface ?? 0} new pages, ${d.collectedCount ?? 0} total.`;
  }
  if (event === "page_discovered") return label ? `تم اكتشاف صفحة: ${compactText(d.pageName, "Page")}` : `Page discovered: ${compactText(d.pageName, "Page")}`;
  if (event === "early_finish") return label ? `تم إنهاء الفحص مبكرًا بعد العثور على ${d.collectedCount ?? 0} صفحة.` : `Finished early after finding ${d.collectedCount ?? 0} pages.`;
  if (event === "early_stop_no_results") return label ? "توقف الفحص بعد عدة مسارات بدون نتائج." : "Stopped after multiple empty surfaces.";
  if (event === "job_completed") return label ? `اكتملت المهمة: ${d.collectedCount ?? 0} صفحة محفوظة.` : `Job completed: ${d.collectedCount ?? 0} pages saved.`;
  if (event === "job_failed") return label ? `فشلت المهمة: ${compactText(d.reason ?? d.error)}` : `Job failed: ${compactText(d.reason ?? d.error)}`;
  if (event === "step_started") return label ? `بدء مرحلة ${stage || "غير معروفة"}.` : `Started ${stage || "step"}.`;
  if (event === "step_finished") {
    const suffix = count !== undefined ? (label ? ` — نتائج: ${count}` : ` — count: ${count}`) : "";
    return label ? `انتهت مرحلة ${stage || "غير معروفة"}${duration ? ` خلال ${duration}` : ""}${suffix}.` : `Finished ${stage || "step"}${duration ? ` in ${duration}` : ""}${suffix}.`;
  }
  if (event === "step_failed") return label ? `فشلت مرحلة ${stage || "غير معروفة"}: ${compactText(d.error)}` : `${stage || "Step"} failed: ${compactText(d.error)}`;
  if (event === "collector_failed") return label ? `فشل قارئ ${compactText(d.collector)}: ${compactText(d.error)}` : `${compactText(d.collector)} collector failed: ${compactText(d.error)}`;

  return label ? `حدث ${event || "تشخيص"}${stage ? ` في ${stage}` : ""}.` : `${event || "Diagnostic"}${stage ? ` at ${stage}` : ""}.`;
}

function ExtractPagesLogPanel({ rows, lang, loading }: { rows: ExtractLogRow[]; lang: "ar" | "en"; loading?: boolean }) {
  const items = rows.slice(-20).reverse();
  const ar = lang === "ar";

  return (
    <div className="mt-4 rounded-md border bg-muted/20 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">
          {ar ? "سجل مراحل استخراج الصفحات" : "Page extraction stage log"}
        </span>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {rows.length}
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {ar ? "جاري تحميل سجل التشخيص..." : "Loading diagnostics..."}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          {ar
            ? "لم يصل سجل مراحل بعد. إذا ظلت المهمة Pending أكثر من دقيقتين فهذا يعني أن الوركر لم يلتقطها."
            : "No stage log yet. If the job stays pending for over two minutes, the worker has not picked it up."}
        </p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pe-1">
          {items.map((row) => {
            const event = compactText(row.data.event);
            const isFail = /failed|rejected|expired/i.test(event) || Boolean(row.data.error);
            const time = new Date(row.created_at).toLocaleTimeString(ar ? "ar-EG" : "en-US", { hour12: false });
            return (
              <li key={row.id} className="flex items-start gap-2 border-b border-border/40 pb-1.5 last:border-b-0">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{time}</span>
                <span className={isFail ? "text-destructive" : "text-foreground/90"}>
                  {formatExtractPagesLog(row, lang)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function describeExtractPagesError(message: string | null | undefined, lang: "ar" | "en") {
  const raw = message || "";
  if (/SESSION_EXPIRED|Facebook rejected|stored session cookies|redirected to login|checkpoint|c_user|not logged in/i.test(raw)) {
    return lang === "ar"
      ? "جلسة فيسبوك لهذا الحساب غير صالحة فعليًا. أعد تصدير الكوكيز من نفس المتصفح الذي الحساب مفتوح عليه، ثم اربط الحساب من جديد."
      : "This Facebook session is not valid anymore. Re-export fresh cookies from the same logged-in browser, then reconnect the account.";
  }
  if (/لم يعثر|no pages|0 pages|لم يتم العثور/i.test(raw)) {
    return lang === "ar"
      ? "لم يرجع البوت أي صفحة من فيسبوك. هذا يعني أن الفشل حدث داخل مرحلة قراءة واجهة/بيانات فيسبوك، وليس دليلاً على أن الحساب لا يملك صفحات. أعد المحاولة بعد تحديث البوت، وسيظهر التشخيص في السجل."
      : "The bot did not return any Facebook pages. This means extraction failed while reading Facebook UI/data, not that the account has no pages. Retry after the worker is updated; diagnostics are saved in the job log.";
  }
  return raw || (lang === "ar" ? "فشل استخراج الصفحات. حاول مرة أخرى." : "Page extraction failed. Try again.");
}

function timeAgo(iso: string | null, lang: "ar" | "en"): string {
  if (!iso) return lang === "ar" ? "—" : "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return lang === "ar" ? "الآن" : "just now";
  if (m < 60) return lang === "ar" ? `منذ ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "ar" ? `منذ ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return lang === "ar" ? `منذ ${d} يوم` : `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function MessengerContactsPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();

  const listPagesFn = useServerFn(listMessengerPages);
  const listContactsFn = useServerFn(listMessengerContacts);
  const syncStatusFn = useServerFn(getMessengerSyncStatus);
  const startSyncFn = useServerFn(startMessengerSync);
  const sendBroadcastFn = useServerFn(sendMessengerBroadcast);
  const updateTagsFn = useServerFn(updateMessengerContactTags);
  const listBotAccountsFn = useServerFn(listBotAccounts);
  const createExtractPagesJobFn = useServerFn(createExtractPagesJob);
  const listJobsFn = useServerFn(listJobs);
  const getJobFn = useServerFn(getJob);

  const [pageId, setPageId] = useState<string | null>(null);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [search, setSearch] = useState("");
  const [lastActivity, setLastActivity] = useState<string>("all");
  const [sort, setSort] = useState<"last_message_desc" | "last_message_asc" | "messages_desc" | "name_asc">(
    "last_message_desc",
  );
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignText, setCampaignText] = useState("");
  const [campaignTag, setCampaignTag] = useState<(typeof MESSAGE_TAGS)[number]>("HUMAN_AGENT");
  const [tagContact, setTagContact] = useState<Contact | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [refetchedForExtractJobId, setRefetchedForExtractJobId] = useState<string | null>(null);

  // Pages query — decides whether to show picker.
  const pagesQ = useQuery({
    queryKey: ["msgr-pages"],
    queryFn: () => listPagesFn(),
  });

  const pages = pagesQ.data ?? [];
  const noPagesReady = !pagesQ.isLoading && !pagesQ.error && pages.length === 0;

  const botAccountsQ = useQuery({
    queryKey: ["msgr-bot-accounts"],
    enabled: noPagesReady,
    queryFn: () => listBotAccountsFn(),
  });

  const extractJobsQ = useQuery({
    queryKey: ["msgr-extract-pages-jobs"],
    enabled: noPagesReady,
    queryFn: () => listJobsFn(),
    refetchInterval: (q) => {
      const jobs = (q.state.data ?? []) as FbJob[];
      return jobs.some((job) => job.job_type === "extract_pages" && ["pending", "running"].includes(job.status))
        ? 2000
        : false;
    },
  });

  useEffect(() => {
    const jobs = (extractJobsQ.data ?? []) as FbJob[];
    const completedJob = jobs.find((job) => job.job_type === "extract_pages" && job.status === "completed");
    if (completedJob && completedJob.id !== refetchedForExtractJobId) {
      setRefetchedForExtractJobId(completedJob.id);
      pagesQ.refetch();
    }
  }, [extractJobsQ.data, pagesQ, refetchedForExtractJobId]);

  useEffect(() => {
    const jobs = (extractJobsQ.data ?? []) as FbJob[];
    const failedSessionJob = jobs.find(
      (job) =>
        job.job_type === "extract_pages" &&
        job.status === "failed" &&
        /SESSION_EXPIRED|Facebook rejected|stored session cookies|redirected to login|checkpoint|c_user/i.test(job.error_message || ""),
    );
    if (failedSessionJob) qc.invalidateQueries({ queryKey: ["msgr-bot-accounts"] });
  }, [extractJobsQ.data, qc]);

  const extractPagesM = useMutation({
    mutationFn: (accountId: string) => createExtractPagesJobFn({ data: { accountId } }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم بدء فحص جلسة فيسبوك واستخراج الصفحات. ستظهر الصفحات هنا تلقائياً عند اكتمال المهمة." : "Facebook session check and page extraction started. Pages will appear here automatically when it finishes.");
      qc.invalidateQueries({ queryKey: ["msgr-extract-pages-jobs"] });
      qc.invalidateQueries({ queryKey: ["msgr-pages"] });
    },
    onError: (e: Error) => {
      toast.error(describeExtractPagesError(e.message, lang));
      qc.invalidateQueries({ queryKey: ["msgr-bot-accounts"] });
      qc.invalidateQueries({ queryKey: ["msgr-extract-pages-jobs"] });
    },
  });

  // Auto-pick when there's exactly one page; otherwise force explicit choice.
  useEffect(() => {
    if (pageId) return;
    if (pages.length === 1) {
      setPageId(pages[0].pageId);
    } else if (pages.length > 1) {
      setShowPagePicker(true);
    }
  }, [pageId, pages]);


  const contactsQ = useQuery({
    queryKey: ["msgr-contacts", pageId, search, lastActivity, sort, page],
    enabled: Boolean(pageId),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listContactsFn({
        data: {
          pageId: pageId!,
          search: search.trim() || undefined,
          lastActivity: lastActivity === "all" ? undefined : (lastActivity as never),
          sort,
          page,
          pageSize,
        },
      }),
  });

  const statusQ = useQuery({
    queryKey: ["msgr-sync-status", pageId],
    enabled: Boolean(pageId),
    queryFn: () => syncStatusFn({ data: { pageId: pageId! } }),
    refetchInterval: (q) => {
      const s = (q.state.data as { job?: { status?: string } } | undefined)?.job?.status;
      return s === "running" || s === "queued" ? 3000 : false;
    },
  });

  const syncM = useMutation({
    mutationFn: (mode: "initial" | "incremental") =>
      startSyncFn({ data: { pageId: pageId!, mode } }),
    onSuccess: (res) => {
      toast.success(
        lang === "ar"
          ? `تمت المزامنة: ${res.upserted ?? 0} جهة اتصال — ${res.stopReason ?? ""}`
          : `Sync done: ${res.upserted ?? 0} contacts — ${res.stopReason ?? ""}`,
      );
      qc.invalidateQueries({ queryKey: ["msgr-contacts", pageId] });
      qc.invalidateQueries({ queryKey: ["msgr-sync-status", pageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const broadcastM = useMutation({
    mutationFn: (input: { text: string; tag: (typeof MESSAGE_TAGS)[number] }) =>
      sendBroadcastFn({
        data: {
          pageId: pageId!,
          contactIds: Array.from(selected),
          text: input.text,
          messageTag: input.tag,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        lang === "ar"
          ? `تم الإرسال: ${res.success}/${res.total} (فشل ${res.failed})`
          : `Sent ${res.success}/${res.total} (${res.failed} failed)`,
      );
      setCampaignOpen(false);
      setCampaignText("");
      setSelected(new Set());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tagsM = useMutation({
    mutationFn: (input: { contactId: string; tags: string[] }) =>
      updateTagsFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msgr-contacts", pageId] });
      setTagContact(null);
      setTagInput("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (contactsQ.data?.rows ?? []) as Contact[];
  const total = contactsQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) rows.forEach((r) => next.delete(r.id));
    else rows.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const currentPage = pages.find((p) => p.pageId === pageId);
  const syncJob = statusQ.data?.job;
  const syncRunning = syncJob?.status === "running" || syncJob?.status === "queued";
  const botAccountsAll = (botAccountsQ.data?.accounts ?? []) as BotAccount[];
  const botAccounts = botAccountsAll.filter(
    (account) => account.status === "active",
  );
  const invalidBotAccounts = botAccountsAll.filter((account) => account.status !== "active");
  const extractJobs = ((extractJobsQ.data ?? []) as FbJob[]).filter((job) => job.job_type === "extract_pages");
  const latestExtractJob = extractJobs[0];
  const latestExtractJobDetailsQ = useQuery({
    queryKey: ["msgr-extract-pages-job-details", latestExtractJob?.id],
    enabled: Boolean(noPagesReady && latestExtractJob?.id),
    queryFn: () => getJobFn({ data: { id: latestExtractJob!.id } }),
    refetchInterval: (q) => {
      const job = (q.state.data as { job?: FbJob | null } | undefined)?.job ?? latestExtractJob;
      return job && ["pending", "running"].includes(job.status) ? 2000 : false;
    },
  });
  const extractRunning = latestExtractJob && ["pending", "running"].includes(latestExtractJob.status);
  const latestExtractProgress = latestExtractJob?.progress ?? 0;
  const latestExtractProcessed = latestExtractJob?.processed_items ?? 0;
  const latestExtractTotal = latestExtractJob?.total_items ?? 0;
  const extractLogRows = useMemo<ExtractLogRow[]>(() => {
    const results = ((latestExtractJobDetailsQ.data as { results?: JobResult[] } | undefined)?.results ?? []) as JobResult[];
    return results
      .filter((row) => row.data?.kind === "log" && row.data?.job_type === "extract_pages")
      .map((row) => ({ id: row.id, created_at: row.created_at, data: row.data as Record<string, unknown> }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [latestExtractJobDetailsQ.data]);
  const latestExtractLog = extractLogRows[extractLogRows.length - 1] ?? null;

  // Live elapsed timer for the running job.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!extractRunning) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [extractRunning]);
  const jobStartMs = latestExtractJob
    ? new Date(latestExtractJob.started_at || latestExtractJob.created_at).getTime()
    : null;
  const elapsedSec = jobStartMs ? Math.max(0, Math.floor((nowTick - jobStartMs) / 1000)) : 0;
  const elapsedLabel = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;
  const pendingTooLong = latestExtractJob?.status === "pending" && elapsedSec >= 120;

  // Phase timeline — derived from status + progress + count.
  type Phase = { key: string; ar: string; en: string };
  const phases: Phase[] = [
    { key: "queued", ar: "في قائمة الانتظار", en: "Queued" },
    { key: "login", ar: "فتح فيسبوك والتحقق من الجلسة", en: "Opening Facebook & verifying session" },
    { key: "scan", ar: "قراءة قائمة الصفحات التي تديرها", en: "Reading pages you manage" },
    { key: "collect", ar: "حفظ الصفحات المُدارة فقط", en: "Saving managed pages only" },
    { key: "done", ar: "اكتملت المهمة", en: "Completed" },
  ];
  let currentPhaseIdx = 0;
  if (latestExtractJob) {
    if (latestExtractJob.status === "pending") currentPhaseIdx = 0;
    else if (latestExtractJob.status === "completed") currentPhaseIdx = 4;
    else if (latestExtractProcessed > 0) currentPhaseIdx = 3;
    else if (latestExtractProgress >= 12) currentPhaseIdx = 2;
    else currentPhaseIdx = 1;
  }

  const latestExtractStatusText = latestExtractJob
    ? latestExtractJob.status === "pending"
      ? pendingTooLong
        ? lang === "ar"
          ? "المهمة لم يلتقطها الوركر خلال دقيقتين؛ غالبًا الوركر متوقف أو لا يعلن صلاحية extract_pages_resilient."
          : "The worker did not pick this up within two minutes; it is likely offline or missing extract_pages_resilient capability."
        : lang === "ar"
          ? "المهمة في الانتظار حتى يلتقطها البوت (عادةً خلال ثوانٍ)."
          : "Waiting for the bot to pick up the job (usually a few seconds)."
      : latestExtractJob.status === "running"
        ? phases[currentPhaseIdx][lang === "ar" ? "ar" : "en"]
        : latestExtractJob.status === "completed"
          ? lang === "ar"
            ? `اكتمل الاستخراج: ${latestExtractProcessed || latestExtractTotal} صفحة مكتشفة.`
            : `Extraction completed: ${latestExtractProcessed || latestExtractTotal} pages found.`
          : latestExtractJob.status === "failed"
            ? describeExtractPagesError(latestExtractJob.error_message, lang)
            : latestExtractJob.status
    : null;
  const currentActivityText = latestExtractLog ? formatExtractPagesLog(latestExtractLog, lang) : latestExtractStatusText;

  const rtl = lang === "ar";

  return (
    <DashboardLayout title={lang === "ar" ? "جهات اتصال Messenger" : "Messenger Contacts"}>
    <div className="space-y-6 p-4 sm:p-6" dir={rtl ? "rtl" : "ltr"}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">
              {lang === "ar" ? "جهات اتصال Messenger" : "Messenger Contacts"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === "ar"
                ? "كل من راسل صفحاتك عبر Messenger — قابل للبحث والاستهداف بحملات."
                : "Everyone who messaged your Pages — searchable and retargetable."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pages.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setShowPagePicker(true)}>
              <Users className="h-4 w-4" />
              {currentPage?.pageName ?? (lang === "ar" ? "اختر صفحة" : "Pick a page")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!pageId || syncM.isPending || syncRunning}
            onClick={() => syncM.mutate("incremental")}
          >
            {syncM.isPending || syncRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {lang === "ar" ? "مزامنة الآن" : "Sync now"}
          </Button>
        </div>
      </header>

      {/* Gate: loading pages */}
      {pagesQ.isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          {lang === "ar" ? "جاري تحميل صفحاتك..." : "Loading your pages..."}
        </Card>
      )}

      {/* Gate: page loading failed */}
      {!pagesQ.isLoading && pagesQ.error && (
        <Card className="p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="mb-1 text-lg font-semibold">
            {lang === "ar" ? "تعذر تحميل صفحاتك" : "Could not load your pages"}
          </h2>
          <p className="mx-auto mb-4 max-w-2xl text-sm text-muted-foreground">
            {pagesQ.error instanceof Error ? pagesQ.error.message : String(pagesQ.error)}
          </p>
          <Button variant="outline" onClick={() => pagesQ.refetch()}>
            <RefreshCw className="h-4 w-4" />
            {lang === "ar" ? "إعادة المحاولة" : "Retry"}
          </Button>
        </Card>
      )}

      {/* Gate: no pages linked */}
      {noPagesReady && (
        <Card className="p-8 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold">
            {lang === "ar" ? "لم يتم تحميل صفحاتك بعد" : "Your pages are not loaded yet"}
          </h2>
          <p className="mx-auto mb-5 max-w-2xl text-sm text-muted-foreground">
            {lang === "ar"
              ? "إذا كنت تستخدم ربط الكوكيز، اختر حساب بوت متصل لاستخراج الصفحات أولاً، وبعدها ستحدد الصفحة المستهدفة."
              : "If you use cookie login, choose an active bot account to extract pages first, then select the target page."}
          </p>

          {botAccountsQ.isLoading ? (
            <div className="text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
              {lang === "ar" ? "جاري فحص حسابات البوت..." : "Checking bot accounts..."}
            </div>
          ) : botAccounts.length > 0 ? (
            <div className="mx-auto max-w-2xl space-y-3 text-start">
              {latestExtractJob && (
                <div className="rounded-lg border bg-card p-4 text-sm shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {extractRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : latestExtractJob.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : latestExtractJob.status === "failed" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : null}
                      <span className="font-semibold">
                        {lang === "ar" ? "استخراج الصفحات" : "Page extraction"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {extractRunning && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                          {elapsedLabel}
                        </span>
                      )}
                      <Badge variant={extractRunning ? "secondary" : latestExtractJob.status === "completed" ? "default" : "destructive"}>
                        {latestExtractJob.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Big live counter */}
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className={`text-4xl font-bold tabular-nums ${extractRunning ? "text-primary" : "text-foreground"}`}>
                      {latestExtractProcessed}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {lang === "ar" ? "صفحة تم اكتشافها" : "pages discovered"}
                    </span>
                  </div>

                  {/* Progress bar (indeterminate stripe when 0 while running) */}
                  <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    {extractRunning && latestExtractProgress < 5 ? (
                      <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-primary/70" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max(3, Math.min(100, latestExtractProgress))}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                    <span>{Math.max(0, Math.min(100, Math.round(latestExtractProgress)))}%</span>
                    {extractRunning && (
                      <span>{lang === "ar" ? "التحديث كل ثانيتين" : "auto-refresh every 2s"}</span>
                    )}
                  </div>

                  {/* Phase timeline */}
                  {latestExtractJob.status !== "failed" && (
                    <ol className="mt-4 space-y-1.5">
                      {phases.map((p, i) => {
                        const done = i < currentPhaseIdx || latestExtractJob.status === "completed";
                        const active = i === currentPhaseIdx && extractRunning;
                        return (
                          <li key={p.key} className="flex items-center gap-2 text-xs">
                            <span
                              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                done
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : active
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-muted-foreground/30 text-muted-foreground/60"
                              }`}
                            >
                              {done ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : active ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <span className="text-[9px]">{i + 1}</span>
                              )}
                            </span>
                            <span className={active ? "font-medium text-foreground" : done ? "text-foreground/70" : "text-muted-foreground"}>
                              {lang === "ar" ? p.ar : p.en}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {currentActivityText ? (
                    <p className={`mt-3 text-xs ${latestExtractJob.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                      <span className="font-medium text-foreground">
                        {lang === "ar" ? "النشاط الحالي: " : "Current activity: "}
                      </span>
                      {currentActivityText}
                    </p>
                  ) : null}

                  <ExtractPagesLogPanel rows={extractLogRows} lang={lang} loading={latestExtractJobDetailsQ.isFetching && extractLogRows.length === 0} />
                </div>
              )}

              {botAccounts.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Cookie className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium">{account.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {lang === "ar" ? "حساب بوت متصل" : "Active bot account"}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={extractPagesM.isPending || Boolean(extractRunning)}
                    onClick={() => extractPagesM.mutate(account.id)}
                  >
                    {(extractPagesM.isPending || extractRunning) && <Loader2 className="h-4 w-4 animate-spin" />}
                    {lang === "ar" ? "استخراج الصفحات" : "Extract pages"}
                  </Button>
                </div>
              ))}
            </div>
          ) : invalidBotAccounts.length > 0 ? (
            <div className="mx-auto max-w-2xl space-y-3 text-start">
              <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {lang === "ar" ? "الحسابات المرتبطة غير جاهزة للاستخراج" : "Connected accounts are not ready for extraction"}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "لن يتم إنشاء مهمة استخراج صفحات لحساب رفضه فيسبوك أو انتهت جلسته. أعد ربط الحساب بكوكيز جديدة ثم جرّب مرة أخرى."
                    : "A page extraction job will not be created for an account rejected by Facebook or with an expired session. Reconnect with fresh cookies and try again."}
                </p>
              </div>
              {invalidBotAccounts.slice(0, 4).map((account) => (
                <div key={account.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{account.display_name}</span>
                    <Badge variant="destructive">{account.status}</Badge>
                  </div>
                  {account.last_error ? (
                    <p className="mt-2 text-xs text-destructive">
                      {describeExtractPagesError(account.last_error, lang)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {lang === "ar"
                  ? "لا يوجد ربط رسمي ولا حساب بوت متصل حالياً. اربط حساب Facebook أولاً ثم ارجع لهذا التبويب."
                  : "No official connection or active bot account is available. Connect Facebook first, then return here."}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Gate: pages exist but none selected */}
      {!pagesQ.isLoading && pages.length > 0 && !pageId && (
        <Card className="p-8 text-center">
          <MessageCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold">
            {lang === "ar" ? "حدد الصفحة المستهدفة" : "Select a target page"}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {lang === "ar"
              ? "اختر الصفحة التي تريد عرض جهات اتصال Messenger الخاصة بها."
              : "Choose the page whose Messenger contacts you want to view."}
          </p>
          <Button onClick={() => setShowPagePicker(true)}>
            <Users className="h-4 w-4" />
            {lang === "ar" ? "اختر صفحة" : "Pick a page"}
          </Button>
        </Card>
      )}

      {/* Main content — only when a page is selected */}
      {pageId && (
      <>



      {/* Sync progress banner */}
      {syncJob && (
        <Card className="p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant={syncJob.status === "completed" ? "default" : "secondary"}>
                {syncJob.status}
              </Badge>
              <span className="text-muted-foreground">
                {lang === "ar" ? "آخر مزامنة" : "Last sync"}:{" "}
                {timeAgo(syncJob.finished_at ?? syncJob.started_at ?? null, lang)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {lang === "ar"
                ? `محادثات: ${syncJob.conversations_scanned ?? 0} · محدَّث: ${syncJob.contacts_upserted ?? 0}`
                : `Conv: ${syncJob.conversations_scanned ?? 0} · upserted: ${syncJob.contacts_upserted ?? 0}`}
              {syncJob.error_message ? ` · ${syncJob.error_message}` : ""}
            </div>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute top-2.5 h-4 w-4 text-muted-foreground start-2.5" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={lang === "ar" ? "بحث بالاسم..." : "Search by name..."}
            className="ps-8"
          />
        </div>
        <Select
          value={lastActivity}
          onValueChange={(v) => {
            setLastActivity(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{lang === "ar" ? "كل الفترات" : "Any time"}</SelectItem>
            <SelectItem value="day">{lang === "ar" ? "آخر 24 ساعة" : "Last 24 hours"}</SelectItem>
            <SelectItem value="week">{lang === "ar" ? "آخر أسبوع" : "Last week"}</SelectItem>
            <SelectItem value="month">{lang === "ar" ? "آخر شهر" : "Last month"}</SelectItem>
            <SelectItem value="quarter">{lang === "ar" ? "آخر 3 شهور" : "Last 3 months"}</SelectItem>
            <SelectItem value="inactive_30d">{lang === "ar" ? "لم يتفاعل +30 يوم" : "Inactive 30d+"}</SelectItem>
            <SelectItem value="inactive_90d">{lang === "ar" ? "لم يتفاعل +90 يوم" : "Inactive 90d+"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as never)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_message_desc">{lang === "ar" ? "الأحدث تفاعلاً" : "Newest activity"}</SelectItem>
            <SelectItem value="last_message_asc">{lang === "ar" ? "الأقدم تفاعلاً" : "Oldest activity"}</SelectItem>
            <SelectItem value="messages_desc">{lang === "ar" ? "الأكثر رسائل" : "Most messages"}</SelectItem>
            <SelectItem value="name_asc">{lang === "ar" ? "الاسم أ-ي" : "Name A-Z"}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border bg-primary/5 px-3 py-2 text-sm">
          <span>
            {lang === "ar" ? `تم اختيار ${selected.size}` : `${selected.size} selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="h-4 w-4" />
              {lang === "ar" ? "إلغاء" : "Clear"}
            </Button>
            <Button size="sm" onClick={() => setCampaignOpen(true)}>
              <Send className="h-4 w-4" />
              {lang === "ar" ? "إرسال حملة Messenger" : "Send Messenger campaign"}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="w-10 p-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="select all"
                  />
                </th>
                <th className="p-3 text-start">{lang === "ar" ? "الاسم" : "Name"}</th>
                <th className="p-3 text-start">{lang === "ar" ? "الصفحة" : "Page"}</th>
                <th className="p-3 text-start">{lang === "ar" ? "آخر تفاعل" : "Last activity"}</th>
                <th className="p-3 text-start">{lang === "ar" ? "الرسائل" : "Messages"}</th>
                <th className="p-3 text-start">{lang === "ar" ? "آخر رسالة" : "Last message"}</th>
                <th className="p-3 text-start">{lang === "ar" ? "الوسوم" : "Tags"}</th>
              </tr>
            </thead>
            <tbody>
              {contactsQ.isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    {lang === "ar"
                      ? "لا توجد جهات اتصال بعد. اضغط \"مزامنة الآن\" لجلبها من Messenger."
                      : "No contacts yet. Click \"Sync now\" to import from Messenger."}
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">
                      <Checkbox
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {c.profile_pic_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.profile_pic_url}
                            alt=""
                            loading="lazy"
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs">
                            {(c.full_name ?? "?").slice(0, 2)}
                          </div>
                        )}
                        <span className="font-medium">
                          {c.full_name ?? (lang === "ar" ? "غير معروف" : "Unknown")}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{c.page_name ?? c.page_id}</td>
                    <td className="p-3 text-muted-foreground">{timeAgo(c.last_message_at, lang)}</td>
                    <td className="p-3">{c.messages_count}</td>
                    <td className="p-3 max-w-[220px] truncate text-muted-foreground">
                      {c.last_message_preview ?? "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {c.tags.map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1"
                          onClick={() => {
                            setTagContact(c);
                            setTagInput(c.tags.join(", "));
                          }}
                        >
                          <Tag className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">
            {lang === "ar"
              ? `${total} جهة اتصال — صفحة ${page}/${totalPages}`
              : `${total} contacts — page ${page}/${totalPages}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronRight className="h-4 w-4 rtl:hidden" />
              <ChevronLeft className="h-4 w-4 ltr:hidden" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronLeft className="h-4 w-4 rtl:hidden" />
              <ChevronRight className="h-4 w-4 ltr:hidden" />
            </Button>
          </div>
        </div>
      </Card>
      </>
      )}

      {/* Page picker */}

      <Dialog open={showPagePicker} onOpenChange={setShowPagePicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lang === "ar" ? "اختر الصفحة" : "Pick a page"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? "اختر الصفحة التي تريد استيراد محادثاتها."
                : "Choose the page whose conversations you want to import."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pages.map((p) => (
              <button
                key={p.pageId}
                onClick={() => {
                  setPageId(p.pageId);
                  setShowPagePicker(false);
                  setSelected(new Set());
                  setPage(1);
                }}
                className="flex w-full items-center gap-3 rounded-md border p-3 text-start hover:bg-muted/40"
              >
                {p.avatarUrl ? (
                  <img src={p.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-muted" />
                )}
                <div className="flex-1">
                  <div className="font-medium">{p.pageName}</div>
                  <div className="text-xs text-muted-foreground">{p.pageId}</div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Campaign dialog */}
      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {lang === "ar" ? "حملة Messenger" : "Messenger campaign"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? `${selected.size} مستلم · التزم بسياسة Meta.`
                : `${selected.size} recipients · respect Meta policy.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={5}
              value={campaignText}
              onChange={(e) => setCampaignText(e.target.value)}
              placeholder={lang === "ar" ? "اكتب رسالتك..." : "Write your message..."}
              maxLength={2000}
            />
            <div>
              <label className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? "Message Tag (مطلوب لأي مستلم خارج نافذة 24 ساعة)"
                  : "Message Tag (required for recipients outside the 24h window)"}
              </label>
              <Select value={campaignTag} onValueChange={(v) => setCampaignTag(v as never)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESSAGE_TAGS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCampaignOpen(false)}>
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              disabled={broadcastM.isPending || campaignText.trim().length === 0}
              onClick={() => broadcastM.mutate({ text: campaignText, tag: campaignTag })}
            >
              {broadcastM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === "ar" ? "إرسال" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={Boolean(tagContact)} onOpenChange={(o) => !o && setTagContact(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lang === "ar" ? "إدارة الوسوم" : "Manage tags"}</DialogTitle>
          </DialogHeader>
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder={lang === "ar" ? "وسوم مفصولة بفواصل" : "Comma-separated tags"}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTagContact(null)}>
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              disabled={tagsM.isPending || !tagContact}
              onClick={() =>
                tagContact &&
                tagsM.mutate({
                  contactId: tagContact.id,
                  tags: tagInput
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 20),
                })
              }
            >
              {tagsM.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === "ar" ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, RefreshCw, Download, Sparkles, Send, KeyRound, AlertTriangle, Image as ImageIcon, X, Clock, Pause, Play, ArrowUp, ArrowDown, ArrowUpDown, CheckCircle2, XCircle, ShieldAlert, ExternalLink, MessageCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { useFacebookApi } from "@/features/facebook/api";
import { listJobs, getJob, cancelJob, pauseJob, resumeJob, createSendMessengerDmJob, listBotAccounts } from "@/lib/fb-bot.functions";
import { loadEgyptData, extractEgyptPhone, detectLocation } from "@/lib/egypt-enrich";

export const Route = createFileRoute("/dashboard/facebook/history")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: JobsHistoryPage,
});

type JobRow = {
  id: string;
  job_type: "post_to_groups" | "extract_pages" | "extract_commenters" | "extract_group_members" | "extract_page_audience" | "list_my_groups" | "deep_profile_scrape" | "send_messenger_dm";
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";
  progress: number;
  total_items: number;
  processed_items: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  account_id: string | null;
};

type JobResult = { id: string; target: string | null; status: "success" | "failed" | "skipped"; data: unknown; error: string | null; created_at: string };

type MessengerResultStatus = JobResult["status"];
type MessengerFailureKind = "sent" | "privacy" | "limited" | "session" | "noMessageButton" | "unavailable" | "blocked" | "invalidTarget" | "unknown";

const messengerFailureKind = (err: string | null, status?: MessengerResultStatus): MessengerFailureKind => {
  if (status === "success" || (!err && status !== "failed")) return "sent";
  const e = (err ?? "").toLowerCase();
  if (e.includes("session") || e.includes("checkpoint") || e.includes("login")) return "session";
  if (e.includes("account_rate_limit") || e.includes("temporarily limited") || e.includes("action blocked") || e.includes("restricted")) return "limited";
  if (e.includes("profile_message_button_missing") || e.includes("visible message button") || e.includes("message button missing")) return "noMessageButton";
  if (e.includes("recipient_privacy") || e.includes("closed dms") || e.includes("not friends") || e.includes("can't message") || e.includes("cannot message")) return "privacy";
  if (e.includes("no_numeric_id") || e.includes("no_profile_url") || e.includes("not a valid profile")) return "invalidTarget";
  if (e.includes("composer") || e.includes("thread_not_available") || e.includes("messenger_nav_failed") || e.includes("profile_nav_failed")) return "unavailable";
  if (e.includes("blocked") || e.includes("you can no longer send messages")) return "blocked";
  return "unknown";
};

const messengerFriendlyReason = (err: string | null, status: MessengerResultStatus | undefined, lang: string): { title: string; hint: string; code: string } => {
  const ar = lang === "ar";
  const kind = messengerFailureKind(err, status);
  if (kind === "sent") return { title: ar ? "تم الإرسال بنجاح" : "Delivered successfully", hint: ar ? "وصلت الرسالة لهذا المستلم." : "The message was sent to this recipient.", code: "SENT" };
  if (kind === "noMessageButton") return { title: ar ? "لا يوجد زر مراسلة ظاهر" : "No visible message button", hint: ar ? "فيسبوك لا يعرض زر الرسائل لهذا الشخص؛ غالباً بسبب إعدادات الخصوصية أو لأن الحساب ليس صديقاً أو لا يقبل رسائل الغرباء." : "Facebook is not showing a Message button for this person, usually because of privacy settings or non-friend DM restrictions.", code: "NO_MESSAGE_BUTTON" };
  if (kind === "privacy") return { title: ar ? "المستلم لا يقبل رسائل من الغرباء" : "Recipient blocks non-friend DMs", hint: ar ? "الرسالة لم تُرسل لأن إعدادات ماسنجر عند المستلم تمنع طلبات الرسائل من هذا الحساب." : "The recipient's Messenger privacy settings blocked this message request.", code: "RECIPIENT_PRIVACY" };
  if (kind === "limited") return { title: ar ? "حساب الإرسال مقيّد مؤقتاً" : "Sending account temporarily limited", hint: ar ? "فيسبوك قيّد الحساب مؤقتاً. قلّل معدل الإرسال واستخدم حساباً أقدم قبل إعادة المحاولة." : "Facebook temporarily limited this account. Lower the send rate and retry with a warmed-up account.", code: "ACCOUNT_LIMIT" };
  if (kind === "session") return { title: ar ? "جلسة حساب فيسبوك انتهت" : "Facebook session expired", hint: ar ? "أعد ربط حساب فيسبوك من صفحة حسابات البوت ثم شغّل المهمة مرة أخرى." : "Reconnect the Facebook bot account, then run the job again.", code: "SESSION_EXPIRED" };
  if (kind === "invalidTarget") return { title: ar ? "الرابط ليس بروفايل قابل للمراسلة" : "Target is not a messageable profile", hint: ar ? "تم استبعاد الرابط لأنه لا يحتوي على معرف مستخدم فيسبوك يمكن فتح محادثة ماسنجر له." : "The link does not contain a Facebook user ID that can be opened in Messenger.", code: "INVALID_TARGET" };
  if (kind === "unavailable") return { title: ar ? "تعذر فتح محادثة ماسنجر" : "Messenger chat unavailable", hint: ar ? "لم تظهر خانة كتابة الرسالة بعد فتح المحادثة؛ قد يكون الرابط غير صالح أو المحادثة غير متاحة لهذا الحساب." : "The message composer did not appear, so the thread is unavailable for this account.", code: "CHAT_UNAVAILABLE" };
  if (kind === "blocked") return { title: ar ? "فيسبوك منع الرسالة" : "Facebook blocked this DM", hint: ar ? "غالباً بسبب قيود حماية فيسبوك أو تكرار الإرسال. أوقف المهمة وقلّل السرعة." : "Usually caused by Facebook protection rules or repeated sending. Pause and lower the speed.", code: "FACEBOOK_BLOCKED" };
  return { title: ar ? "فشل غير مصنّف" : "Unclassified failure", hint: ar ? "لم نستطع تصنيف السبب تلقائياً. احتفظنا بالكود التقني داخل ملف CSV فقط للمراجعة." : "The reason could not be classified automatically. The raw code is kept in the CSV for review only.", code: "UNKNOWN" };
};

const extractMessengerTargetId = (url: string | null) => {
  if (!url) return null;
  const m = url.match(/(?:groups\/[^/]+\/user\/|user\/|profile\.php\?id=|messages\/t\/|m\.me\/)(\d{5,})/i) || url.match(/^(\d{5,})$/);
  return m ? m[1] : null;
};

const messengerProfileUrl = (target: string | null) => {
  const id = extractMessengerTargetId(target);
  return id ? `https://www.facebook.com/profile.php?id=${id}` : (target ?? "");
};

function JobsHistoryPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [results, setResults] = useState<JobResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<JobRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pausingId, setPausingId] = useState<string | null>(null);
  // Messaging wizard state
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgChannels, setMsgChannels] = useState<{ whatsapp: boolean; messenger: boolean }>({ whatsapp: true, messenger: true });
  const [msgText, setMsgText] = useState("");
  const [msgTitle, setMsgTitle] = useState("");
  const [msgPerHour, setMsgPerHour] = useState(20);
  const [msgSubmitting, setMsgSubmitting] = useState(false);
  const [msgImages, setMsgImages] = useState<string[]>([]);
  const [msgUploading, setMsgUploading] = useState(false);
  const [msgAccounts, setMsgAccounts] = useState<Array<{ id: string; display_name: string; status: string }>>([]);
  const [msgSelectedAccounts, setMsgSelectedAccounts] = useState<Set<string>>(new Set());
  // Recipient filters
  const [msgFilterCity, setMsgFilterCity] = useState("");
  const [msgFilterKeyword, setMsgFilterKeyword] = useState("");
  const [msgRequirePhone, setMsgRequirePhone] = useState(false);
  const [msgRequireProfile, setMsgRequireProfile] = useState(false);
  const [msgDedupe, setMsgDedupe] = useState(true);
  const [msgLimit, setMsgLimit] = useState(500);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [msgSelectedRecipients, setMsgSelectedRecipients] = useState<Set<string>>(new Set());
  const PREVIEW_PAGE_SIZE = 25;
  const recipientKey = (e: { name?: string | null; phone?: string | null; profile?: string | null; row: { target?: string | null } }) =>
    `${(e.profile || e.row.target || "").toLowerCase()}::${(e.phone || "").toString().replace(/\D/g, "")}::${(e.name || "").toLowerCase()}`;

  const t = lang === "ar" ? {
    title: "سجل المهام",
    subtitle: "كل المهام مع تتبع حي للتقدم",
    none: "لا توجد مهام بعد",
    create: "إنشاء مهمة",
    type: "النوع",
    status: "الحالة",
    progress: "التقدم",
    created: "أُنشئت",
    actions: "إجراءات",
    cancel: "إلغاء",
    confirmCancelTitle: "تأكيد إلغاء المهمة",
    confirmCancelDesc: "سيتم إيقاف المعالجة في الخلفية فوراً وحفظ ما تم استخراجه حتى الآن. هل تريد المتابعة؟",
    confirmCancelYes: "نعم، ألغِ المهمة",
    confirmCancelNo: "تراجع",
    cancelDone: "تم إلغاء المهمة وإيقاف المعالجة",
    results: "النتائج",
    download: "تنزيل CSV",
    types: { post_to_groups: "نشر", extract_pages: "صفحات", extract_commenters: "معلقين", extract_group_members: "أعضاء جروب", extract_page_audience: "جمهور صفحة", list_my_groups: "جروباتي", deep_profile_scrape: "فحص عميق للبروفايل", send_messenger_dm: "رسائل ماسنجر" },
    statuses: { pending: "معلّقة", running: "جارية", completed: "مكتملة", failed: "فشلت", cancelled: "ملغاة", paused: "متوقفة مؤقتاً" },
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    pauseDone: "تم إيقاف المهمة مؤقتاً — اضغط استئناف لإكمالها من نفس المكان",
    resumeDone: "تمت إعادة تشغيل المهمة — ستكمل من حيث توقفت",
  } : {
    title: "Jobs History",
    subtitle: "All jobs with live progress",
    none: "No jobs yet",
    create: "Create a job",
    type: "Type",
    status: "Status",
    progress: "Progress",
    created: "Created",
    actions: "Actions",
    cancel: "Cancel",
    confirmCancelTitle: "Cancel job?",
    confirmCancelDesc: "Background processing will stop immediately. Already-extracted data will be kept. Continue?",
    confirmCancelYes: "Yes, cancel job",
    confirmCancelNo: "Keep running",
    cancelDone: "Job cancelled and worker stopped",
    results: "Results",
    download: "Download CSV",
    types: { post_to_groups: "Post", extract_pages: "Pages", extract_commenters: "Commenters", extract_group_members: "Group Members", extract_page_audience: "Page Audience", list_my_groups: "My Groups", deep_profile_scrape: "Deep Profile Scrape", send_messenger_dm: "Messenger DMs" },
    statuses: { pending: "Pending", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", paused: "Paused" },
    pause: "Pause",
    resume: "Resume",
    pauseDone: "Job paused — click Resume to continue from the same point",
    resumeDone: "Job resumed — it will continue from where it stopped",
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await call(listJobs);
      setJobs(data as JobRow[]);
    } catch (e) { toast.error(String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);

  // Realtime: merge changes into local state to avoid full reloads (which feel like a page refresh)
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`fb-jobs-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => [payload.new as JobRow, ...prev.filter((j) => j.id !== (payload.new as JobRow).id)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => prev.map((j) => (j.id === (payload.new as JobRow).id ? { ...j, ...(payload.new as JobRow) } : j)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => prev.filter((j) => j.id !== (payload.old as JobRow).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const openDetails = async (j: JobRow) => {
    setSelected(j);
    setResultsLoading(true);
    try {
      const peopleTypes = ["extract_commenters", "extract_group_members", "extract_page_audience", "deep_profile_scrape"];
      if (peopleTypes.includes(j.job_type)) await loadEgyptData();
      const { results } = await call(getJob, { id: j.id });
      setResults(results as JobResult[]);
    } catch (e) { toast.error(String(e)); }
    finally { setResultsLoading(false); }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await call(cancelJob, { id: cancelTarget.id });
      setJobs((prev) => prev.map((j) => (j.id === cancelTarget.id ? { ...j, status: "cancelled", completed_at: new Date().toISOString() } : j)));
      toast.success(t.cancelDone);
      setCancelTarget(null);
    } catch (e) { toast.error(String(e)); }
    finally { setCancelling(false); }
  };

  const handlePause = async (j: JobRow) => {
    setPausingId(j.id);
    try {
      await call(pauseJob, { id: j.id });
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: "paused" } : x)));
      toast.success(t.pauseDone);
    } catch (e) { toast.error(String(e)); }
    finally { setPausingId(null); }
  };

  const handleResume = async (j: JobRow) => {
    setPausingId(j.id);
    try {
      await call(resumeJob, { id: j.id });
      setJobs((prev) => prev.map((x) => (x.id === j.id ? { ...x, status: "pending", error_message: null } : x)));
      toast.success(t.resumeDone);
    } catch (e) { toast.error(String(e)); }
    finally { setPausingId(null); }
  };

  const isPeople = selected?.job_type === "extract_commenters"
    || selected?.job_type === "extract_group_members"
    || selected?.job_type === "extract_page_audience"
    || selected?.job_type === "deep_profile_scrape";
  const isGroupsList = selected?.job_type === "list_my_groups";
  const isMessenger = selected?.job_type === "send_messenger_dm";
  const groupRows = isGroupsList
    ? results.map((r) => {
        const d = (r.data ?? {}) as { name?: string; url?: string; group_id?: string; id?: string };
        return {
          row: r,
          id: d.group_id ?? d.id ?? r.target ?? "",
          name: d.name ?? r.target ?? "—",
          url: d.url ?? (r.target ? `https://www.facebook.com/groups/${r.target}` : ""),
        };
      })
    : [];
  const enrichedRows = isPeople
    ? results.map((r) => {
        const d = (r.data ?? {}) as { name?: string; id?: string; fb_user_id?: string; profile?: string; profile_url?: string; bio?: string; bio_snippet?: string; city?: string; hometown?: string; work?: string; phone?: string; source?: string };
        const blob = `${d.name ?? ""} ${d.bio ?? ""} ${d.bio_snippet ?? ""} ${d.city ?? ""} ${d.hometown ?? ""} ${r.target ?? ""}`;
        const loc = detectLocation(blob);
        return {
          row: r,
          name: d.name ?? r.target ?? "—",
          profile: d.profile_url ?? d.profile ?? "",
          phone: d.phone ?? extractEgyptPhone(blob) ?? null,
          city: d.city ?? loc?.city ?? null,
          gov: loc?.gov ?? null,
          declared: d.city ?? d.hometown ?? null,
          work: d.work ?? null,
          source: d.source ?? "",
        };
      })
    : [];

  const downloadCsv = () => {
    if (results.length === 0) return;
    let rows: (string | number)[][];
    if (isPeople) {
      rows = [
        ["name", "facebook_id", "profile", "phone", "city", "governorate", "source"],
        ...enrichedRows.map((e) => [e.name, e.row.target ?? "", e.profile, e.phone ?? "", e.city ?? "", e.gov ?? "", e.source]),
      ];
    } else if (isMessenger) {
      rows = [
        ["name", "status", "reason", "hint", "profile", "technical_code", "created_at"],
        ...results.map((r) => {
          const d = (r.data ?? {}) as { name?: string | null };
          const reason = messengerFriendlyReason(r.error, r.status, lang);
          return [d.name ?? "", r.status, reason.title, reason.hint, messengerProfileUrl(r.target), reason.code, r.created_at];
        }),
      ];
    } else if (isGroupsList) {
      rows = [
        ["group_id", "name", "url", "status", "error"],
        ...groupRows.map((g) => [g.id, g.name, g.url, g.row.status, g.row.error ?? ""]),
      ];
    } else {
      rows = [
        ["target", "status", "data", "error", "created_at"],
        ...results.map((r) => [r.target ?? "", r.status, JSON.stringify(r.data ?? ""), r.error ?? "", r.created_at]),
      ];
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `job-${selected?.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: JobRow["status"]) => ({
    pending: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
    paused: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  }[s]);

  // Detect session-expired failures so we surface a clear reconnect CTA
  // instead of a generic "failed" status the user can't act on.
  const isSessionExpired = (j: { status?: string; error_message?: string | null }) =>
    j.status === "failed" && !!j.error_message && /SESSION_EXPIRED|session lost|cookies?\s+(rejected|invalid|expired)|c_user/i.test(j.error_message);

  // Counts for the messaging wizard preview
  const phoneCount = enrichedRows.filter((e) => !!e.phone).length;
  const profileCount = enrichedRows.filter((e) => !!(e.profile || e.row.target)).length;

  // ---- Recipient filtering (applied inside the messaging dialog) ----
  const FB_SYSTEM_RE = /\/(business|help|policies|terms|privacy|ads|adsmanager|careers|about|settings|login|recover|gaming|creator|creators|fundraisers|jobs|messages|notifications|saved|memories|friends|games|weather|crisisresponse|lite|mobile|support|legal|brand|newsroom|community|ai|meta|sharer|plugins|dialog|oauth|l\.php|tr|tr\.php)(\/|$|\?)/i;
  const filteredRows = useMemo(() => {
    const cityQ = msgFilterCity.trim().toLowerCase();
    const kwList = msgFilterKeyword.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const seenPhones = new Set<string>();
    const seenProfiles = new Set<string>();
    const out: typeof enrichedRows = [];
    for (const e of enrichedRows) {
      const profile = e.profile || e.row.target || "";
      const hasPhone = !!e.phone;
      const hasProfile = !!profile && !FB_SYSTEM_RE.test(profile);
      if (msgRequirePhone && !hasPhone) continue;
      if (msgRequireProfile && !hasProfile) continue;
      if (!hasPhone && !hasProfile) continue;
      if (cityQ) {
        const cityBlob = `${e.city ?? ""} ${e.gov ?? ""} ${e.declared ?? ""}`.toLowerCase();
        if (!cityBlob.includes(cityQ)) continue;
      }
      if (kwList.length > 0) {
        const blob = `${e.name ?? ""} ${e.work ?? ""}`.toLowerCase();
        if (!kwList.some((k) => blob.includes(k))) continue;
      }
      if (msgDedupe) {
        if (hasPhone) {
          const key = String(e.phone).replace(/\D/g, "");
          if (seenPhones.has(key)) continue;
          seenPhones.add(key);
        }
        if (hasProfile) {
          const key = profile.toLowerCase();
          if (seenProfiles.has(key)) continue;
          seenProfiles.add(key);
        }
      }
      out.push(e);
      if (out.length >= msgLimit) break;
    }
    return out;
  }, [enrichedRows, msgFilterCity, msgFilterKeyword, msgRequirePhone, msgRequireProfile, msgDedupe, msgLimit]);

  const filteredWaCount = filteredRows.filter((e) => !!e.phone).length;
  const filteredFbCount = filteredRows.filter((e) => {
    const p = e.profile || e.row.target || "";
    return !!p && !FB_SYSTEM_RE.test(p);
  }).length;

  // Prune selection to only keys that still exist in filtered rows
  useEffect(() => {
    if (msgSelectedRecipients.size === 0) return;
    const valid = new Set(filteredRows.map(recipientKey));
    let changed = false;
    const next = new Set<string>();
    for (const k of msgSelectedRecipients) {
      if (valid.has(k)) next.add(k);
      else changed = true;
    }
    if (changed) setMsgSelectedRecipients(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows]);

  // Rows that will actually be sent (selection-aware)
  const sendRows = msgSelectedRecipients.size > 0
    ? filteredRows.filter((e) => msgSelectedRecipients.has(recipientKey(e)))
    : filteredRows;
  const sendWaCount = sendRows.filter((e) => !!e.phone).length;
  const sendFbCount = sendRows.filter((e) => {
    const p = e.profile || e.row.target || "";
    return !!p && !FB_SYSTEM_RE.test(p);
  }).length;


  const openMessenger = async () => {
    if (!selected) return;
    const groupLabel = selected ? t.types[selected.job_type] : "";
    setMsgTitle(lang === "ar" ? `حملة - ${groupLabel}` : `Campaign - ${groupLabel}`);
    setMsgText("");
    setMsgPerHour(20);
    setMsgImages([]);
    setMsgChannels({ whatsapp: phoneCount > 0, messenger: profileCount > 0 });
    setMsgFilterCity("");
    setMsgFilterKeyword("");
    setMsgRequirePhone(false);
    setMsgRequireProfile(false);
    setMsgDedupe(true);
    setMsgLimit(500);
    setMsgSelectedRecipients(new Set());
    setMsgOpen(true);
    // Load active bot accounts (for multi-account rotation)
    try {
      const res = await call(listBotAccounts);
      const accounts = (res?.accounts ?? []).filter((a: { status: string }) => a.status === "active");
      setMsgAccounts(accounts);
      const initial = new Set<string>();
      if (selected.account_id && accounts.some((a: { id: string }) => a.id === selected.account_id)) initial.add(selected.account_id);
      else if (accounts[0]) initial.add(accounts[0].id);
      setMsgSelectedAccounts(initial);
    } catch (_) { /* ignore */ }
  };

  const handleMsgImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!user || files.length === 0) return;
    if (msgImages.length + files.length > 10) {
      toast.error(lang === "ar" ? "حد أقصى 10 صور" : "Max 10 images");
      return;
    }
    setMsgUploading(true);
    try {
      const urls: string[] = [];
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) { toast.error(lang === "ar" ? `${file.name} أكبر من 10MB` : `${file.name} > 10MB`); continue; }
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
        const path = `${user.id}/dm/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safe}`;
        const { error } = await supabase.storage.from("fb-media").upload(path, file, { contentType: file.type, upsert: false });
        if (error) { toast.error(error.message); continue; }
        const { data: pub } = supabase.storage.from("fb-media").getPublicUrl(path);
        urls.push(pub.publicUrl);
      }
      setMsgImages((prev) => [...prev, ...urls]);
    } finally {
      setMsgUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const launchMessaging = async () => {
    if (!user || !selected) return;
    const message = msgText.trim();
    if (message.length < 2) { toast.error(lang === "ar" ? "اكتب نص الرسالة" : "Enter message text"); return; }
    if (!msgChannels.whatsapp && !msgChannels.messenger) { toast.error(lang === "ar" ? "اختر قناة واحدة على الأقل" : "Pick at least one channel"); return; }

    const intervalSec = Math.max(36, Math.round(3600 / Math.max(1, msgPerHour)));
    setMsgSubmitting(true);
    try {
      let waCount = 0;
      let fbCount = 0;

      // ---- WhatsApp: create a bulk_jobs row + recipients (only those with phone)
      if (msgChannels.whatsapp) {
        const waRecipients = sendRows
          .filter((e) => !!e.phone)
          .map((e) => ({ name: e.name || "", phone: String(e.phone) }));
        if (waRecipients.length > 0) {
          const { data: job, error } = await supabase
            .from("bulk_jobs")
            .insert({
              user_id: user.id,
              channel: "bulk",
              title: msgTitle.trim() || (lang === "ar" ? "حملة واتساب" : "WhatsApp campaign"),
              message,
              interval_seconds: intervalSec,
              batch_size: 1,
              scheduled_at: new Date().toISOString(),
              status: "scheduled",
              total_recipients: waRecipients.length,
            })
            .select("id")
            .single();
          if (error || !job) throw new Error(error?.message || "WhatsApp campaign insert failed");
          const rows = waRecipients.map((r) => ({ job_id: job.id, user_id: user.id, name: r.name, phone: r.phone }));
          const { error: rErr } = await supabase.from("bulk_job_recipients").insert(rows);
          if (rErr) throw new Error(rErr.message);
          waCount = waRecipients.length;
        }
      }

      // ---- Messenger: create one fb_jobs send_messenger_dm per selected account.
      // Round-robin recipients across accounts so each account stays under FB's
      // per-account rate. Per-account interval is N× the global interval so the
      // *combined* throughput matches the chosen rate-per-hour.
      if (msgChannels.messenger) {
        const FB_SYSTEM = FB_SYSTEM_RE;
        const fbRecipients = sendRows
          .map((e) => ({ profile: e.profile || e.row.target || "", name: e.name || "" }))
          .filter((r) => !!r.profile && !FB_SYSTEM.test(r.profile));
        const skipped = enrichedRows.filter((e) => {
          const p = e.profile || e.row.target || "";
          return !!p && FB_SYSTEM.test(p);
        }).length;
        if (skipped > 0) {
          toast.info(lang === "ar" ? `تم استبعاد ${skipped} رابط ليس بروفايل مستخدم (صفحات نظامية).` : `Skipped ${skipped} non-user URLs (system pages).`);
        }
        const accountIds = Array.from(msgSelectedAccounts);
        if (fbRecipients.length > 0 && accountIds.length === 0) {
          toast.error(lang === "ar" ? "اختر حساب فيسبوك واحد على الأقل" : "Select at least one Facebook account");
        } else if (fbRecipients.length > 0) {
          const N = accountIds.length;
          const buckets: Record<string, typeof fbRecipients> = Object.fromEntries(accountIds.map((id) => [id, []]));
          fbRecipients.forEach((r, i) => buckets[accountIds[i % N]].push(r));
          const perAccountInterval = Math.max(36, intervalSec * N);
          for (const accId of accountIds) {
            const slice = buckets[accId];
            if (slice.length === 0) continue;
            await call(createSendMessengerDmJob, {
              accountId: accId,
              recipients: slice,
              message,
              intervalSeconds: perAccountInterval,
              imageUrls: msgImages.length ? msgImages : undefined,
              label: msgTitle.trim() || undefined,
            });
            fbCount += slice.length;
          }
        }
      }



      toast.success(
        lang === "ar"
          ? `تم: واتساب ${waCount} · ماسنجر ${fbCount}`
          : `Queued: WhatsApp ${waCount} · Messenger ${fbCount}`,
      );
      setMsgOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setMsgSubmitting(false);
    }
  };


  return (
    <DashboardLayout title={t.title}>
      <div dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}><RefreshCw className="me-2 h-4 w-4" />Refresh</Button>
            <Link to="/dashboard/facebook/jobs"><Button>{t.create}</Button></Link>
          </div>
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : jobs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">{t.none}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.type}</th>
                    <th className="px-4 py-3 text-start">{t.status}</th>
                    <th className="px-4 py-3 text-start">{t.progress}</th>
                    <th className="px-4 py-3 text-start">{t.created}</th>
                    <th className="px-4 py-3 text-end">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {jobs.map((j) => (
                    <tr key={j.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openDetails(j)}>
                      <td className="px-4 py-3"><Badge variant="outline">{t.types[j.job_type]}</Badge></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(j.status)}`}>{t.statuses[j.status]}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex w-48 items-center gap-2">
                          <Progress value={j.progress} className="h-1.5" />
                          <span className="text-xs text-muted-foreground">{j.processed_items}/{j.total_items || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(j.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center justify-end gap-1">
                          {isSessionExpired(j) && (
                            <Link to="/dashboard/facebook/bot" onClick={(e) => e.stopPropagation()}>
                              <Button size="sm" variant="outline" className="h-7 gap-1 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400" title={lang === "ar" ? "إعادة ربط حساب فيسبوك" : "Reconnect Facebook account"}>
                                <KeyRound className="h-3.5 w-3.5" />
                                <span className="text-xs">{lang === "ar" ? "إعادة ربط" : "Reconnect"}</span>
                              </Button>
                            </Link>
                          )}
                           {j.status === "completed" && (j.processed_items > 0) && ["extract_commenters","extract_group_members","extract_page_audience","deep_profile_scrape"].includes(j.job_type) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={lang === "ar" ? "إرسال رسائل" : "Send messages"}
                              onClick={(e) => { e.stopPropagation(); openDetails(j).then(() => openMessenger()); }}
                            >
                              <Send className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                          {j.job_type === "send_messenger_dm" && (j.status === "pending" || j.status === "running") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t.pause}
                              disabled={pausingId === j.id}
                              onClick={(e) => { e.stopPropagation(); handlePause(j); }}
                            >
                              {pausingId === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4 text-amber-600" />}
                            </Button>
                          )}
                          {j.status === "paused" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={t.resume}
                              disabled={pausingId === j.id}
                              onClick={(e) => { e.stopPropagation(); handleResume(j); }}
                            >
                              {pausingId === j.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 text-primary" />}
                            </Button>
                          )}
                          {(j.status === "pending" || j.status === "running" || j.status === "paused") && (
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCancelTarget(j); }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent dir={lang === "ar" ? "rtl" : "ltr"} className="flex max-h-[92dvh] w-[min(calc(100dvw-0.75rem),1040px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100dvw-2rem),1040px)] sm:rounded-xl">
          <DialogHeader className="border-b px-4 py-4 sm:px-6">
            <DialogTitle className="flex flex-col gap-3 text-start sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xl font-bold leading-tight">{selected && t.types[selected.job_type]}</span>
              {results.length > 0 && (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {/* Deep profile scrape hidden */}
                  {isGroupsList && (
                    <Button size="sm" variant="default" asChild className="gap-2">
                      <Link to="/dashboard/facebook/jobs" search={{ tab: "post" }}>
                        {lang === "ar" ? "نشر على هذه الجروبات" : "Post to these groups"}
                      </Link>
                    </Button>
                  )}
                  {isPeople && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const lines = enrichedRows
                          .map((e) => [e.name, e.phone, e.city, e.gov, e.row.target].filter(Boolean).join(" "))
                          .filter(Boolean);
                        try {
                          sessionStorage.setItem("flowtix:enrich:prefill", lines.join("\n"));
                        } catch (_) { /* ignore quota */ }
                        navigate({ to: "/dashboard/enrich" });
                      }}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      {lang === "ar" ? "إثراء بداتا مصر" : "Enrich with Egypt data"}
                    </Button>
                  )}
                  {isPeople && (
                    <Button size="sm" variant="default" onClick={openMessenger} className="gap-2">
                      <Send className="h-4 w-4" />
                      {lang === "ar" ? "إرسال رسائل" : "Send messages"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={downloadCsv}>
                    <Download className="me-2 h-4 w-4" />{t.download}
                  </Button>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6">
            {selected && isSessionExpired(selected) && (
              <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex-1 space-y-2">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    {lang === "ar" ? "انتهت صلاحية جلسة حساب فيسبوك" : "Facebook account session expired"}
                  </p>
                  <p className="text-amber-800/90 dark:text-amber-300/90">
                    {lang === "ar"
                      ? "هذه ليست مشكلة في المنصة. فيسبوك أنهى جلسة الحساب المستخدم. أعد تصدير الكوكيز وحدّث الحساب ثم أعد تشغيل المهمة."
                      : "This is not a platform issue. Facebook ended the bot account session. Re-export cookies, update the account, then re-run the job."}
                  </p>
                  <Link to="/dashboard/facebook/bot">
                    <Button size="sm" className="gap-1.5">
                      <KeyRound className="h-3.5 w-3.5" />
                      {lang === "ar" ? "إعادة ربط الحساب الآن" : "Reconnect account now"}
                    </Button>
                  </Link>
                </div>
              </div>
            )}
            {selected?.status === "failed" && !isSessionExpired(selected) && selected.error_message && (
              <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {selected.error_message}
              </div>
            )}
            {resultsLoading ? (
              <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            ) : results.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <p>{t.none}</p>
                {selected?.job_type === "list_my_groups" && selected.status === "completed" && (
                  <p className="mt-2">
                    {lang === "ar"
                      ? "لم يعثر الـ Worker على جروبات مرئية لهذا الحساب. تأكد أن الحساب عضو فعلاً في جروبات وأن صفحة الجروبات تفتح له داخل فيسبوك."
                      : "The Worker found no visible groups for this account. Make sure the account is actually joined to groups and can open the groups page in Facebook."}
                  </p>
                )}
              </div>
            ) : isPeople ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "الاسم" : "Name"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "موبايل" : "Phone"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "المدينة" : "City"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "المحافظة" : "Governorate"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "البروفايل" : "Profile"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {enrichedRows.map((e) => (
                    <tr key={e.row.id} className={e.gov ? "bg-primary/[0.04]" : ""}>
                      <td className="px-3 py-2 font-medium text-start">{e.name}</td>
                      <td className="px-3 py-2 font-mono text-start">{e.phone ? <bdi dir="ltr">{e.phone}</bdi> : "—"}</td>
                      <td className="px-3 py-2 text-start">{e.city ?? "—"}</td>
                      <td className="px-3 py-2 text-start">
                        {e.gov ? <Badge variant="outline" className="border-primary/30 text-primary">{e.gov}</Badge> : "—"}
                      </td>
                      <td className="px-3 py-2 text-start">
                        {e.profile ? <bdi dir="ltr"><a href={e.profile} target="_blank" rel="noreferrer" className="text-primary hover:underline">↗</a></bdi> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : isGroupsList ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "اسم الجروب" : "Group"}</th>
                    <th className="px-3 py-2 text-start">ID</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "الرابط" : "Link"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {groupRows.map((g) => (
                    <tr key={g.row.id}>
                      <td className="px-3 py-2 font-medium text-start">{g.name}</td>
                      <td className="px-3 py-2 font-mono text-start"><bdi dir="ltr">{g.id || "—"}</bdi></td>
                      <td className="px-3 py-2 text-start">
                        {g.url ? <bdi dir="ltr"><a href={g.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">↗</a></bdi> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : isMessenger ? (
            (() => {
              const succ = results.filter((r) => r.status === "success").length;
              const fail = results.filter((r) => r.status === "failed").length;
              const skip = results.filter((r) => r.status === "skipped").length;
              const topFailure = results.find((r) => r.status === "failed");
              const topMessage = messengerFriendlyReason(topFailure?.error ?? null, topFailure?.status, lang);
              return (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border bg-primary/5 p-3 text-start">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" />{lang === "ar" ? "نجح" : "Sent"}</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums">{succ}</div>
                    </div>
                    <div className="rounded-lg border bg-destructive/5 p-3 text-start">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><XCircle className="h-4 w-4 text-destructive" />{lang === "ar" ? "فشل" : "Failed"}</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums text-destructive">{fail}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-3 text-start">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><MessageCircle className="h-4 w-4 text-primary" />{lang === "ar" ? "الإجمالي" : "Total"}</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums">{results.length}</div>
                      {skip > 0 && <div className="mt-1 text-xs text-muted-foreground">{lang === "ar" ? `متخطّى: ${skip}` : `Skipped: ${skip}`}</div>}
                    </div>
                  </div>

                  {fail > 0 && (
                    <div className="flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                      <div className="space-y-1 text-start">
                        <div className="font-semibold text-destructive">{topMessage.title}</div>
                        <div className="text-muted-foreground">{topMessage.hint}</div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {results.map((r, i) => {
                      const d = (r.data ?? {}) as { name?: string | null };
                      const name = d.name?.trim() || (lang === "ar" ? "بدون اسم" : "Unknown");
                      const id = extractMessengerTargetId(r.target);
                      const profileUrl = messengerProfileUrl(r.target);
                      const ok = r.status === "success";
                      const msg = messengerFriendlyReason(r.error, r.status, lang);
                      return (
                        <div key={r.id} className={`rounded-lg border p-3 ${ok ? "bg-primary/[0.03]" : r.status === "failed" ? "bg-destructive/[0.03]" : "bg-muted/20"}`}>
                          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                            <div className="min-w-0 space-y-2 text-start">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">#{i + 1}</span>
                                <span className="min-w-0 break-words font-semibold">{name}</span>
                              </div>
                              <div className="text-sm font-semibold">{msg.title}</div>
                              <div className="text-xs leading-relaxed text-muted-foreground">{msg.hint}</div>
                              {!ok && <div className="inline-flex rounded-md bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground">{lang === "ar" ? "كود السبب" : "Reason code"}: <bdi dir="ltr" className="ms-1">{msg.code}</bdi></div>}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                              {ok ? (
                                <Badge className="border-primary/30 bg-primary/10 text-primary" variant="outline"><CheckCircle2 className="me-1 h-3 w-3" />{lang === "ar" ? "نجح" : "Sent"}</Badge>
                              ) : r.status === "failed" ? (
                                <Badge className="border-destructive/30 bg-destructive/10 text-destructive" variant="outline"><XCircle className="me-1 h-3 w-3" />{lang === "ar" ? "فشل" : "Failed"}</Badge>
                              ) : (
                                <Badge variant="outline">{r.status}</Badge>
                              )}
                              {profileUrl && (
                                <Button size="sm" variant="outline" asChild className="h-8 gap-1.5">
                                  <a href={profileUrl} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <bdi dir="ltr">{id ? `#${id}` : (lang === "ar" ? "فتح البروفايل" : "Open")}</bdi>
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr><th className="px-3 py-2 text-start">target</th><th className="px-3 py-2 text-start">status</th><th className="px-3 py-2 text-start">details</th></tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono text-start"><bdi dir="ltr">{r.target ?? "—"}</bdi></td>
                      <td className="px-3 py-2 text-start">{r.status}</td>
                      <td className="px-3 py-2 text-muted-foreground text-start">{r.error ?? JSON.stringify(r.data ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && !cancelling && setCancelTarget(null)}>
        <AlertDialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmCancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmCancelDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{t.confirmCancelNo}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} disabled={cancelling} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelling && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.confirmCancelYes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={msgOpen} onOpenChange={(o) => !msgSubmitting && setMsgOpen(o)}>
        <DialogContent dir={lang === "ar" ? "rtl" : "ltr"} className="flex max-h-[92dvh] w-[min(calc(100dvw-0.75rem),920px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[min(calc(100dvw-2rem),920px)] sm:rounded-xl">
          <DialogHeader className="shrink-0 border-b px-3 py-3 sm:px-5 sm:py-4">
            <DialogTitle className="text-start">
              {lang === "ar" ? "إرسال رسائل للمستخرجين" : "Send messages to extracted people"}
            </DialogTitle>
          </DialogHeader>


          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-3 text-start [scrollbar-gutter:stable] sm:px-5 sm:py-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">
              <div className="font-semibold mb-1">
                {lang === "ar" ? "ملخّص المستلمين" : "Recipient summary"}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {lang === "ar" ? `أرقام واتساب: ${phoneCount}` : `WhatsApp numbers: ${phoneCount}`}
                </Badge>
                <Badge variant="secondary">
                  {lang === "ar" ? `بروفايلات ماسنجر: ${profileCount}` : `Messenger profiles: ${profileCount}`}
                </Badge>
              </div>
              {phoneCount === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "💡 لا توجد أرقام؟ شغّل «إثراء بداتا مصر» أولاً."
                    : "💡 No phones? Run “Enrich with Egypt data” first."}
                </p>
              )}
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                {lang === "ar"
                  ? "⚠️ ماسنجر يتطلب أن يقبل الطرف الآخر الرسائل من الغرباء. الصفحات الرسمية (مثل /business و /help) لن تستقبل DM وستظهر كـ «فشل». هذا طبيعي وليس عطل بالنظام."
                  : "⚠️ Messenger requires the recipient to accept DMs from strangers. Official Pages (e.g. /business, /help) won't accept DMs and will appear as 'failed'. That's normal, not a bug."}
              </p>

            </div>

            <div className="space-y-2">
              <Label className="block text-start">
                {lang === "ar" ? "اسم الحملة" : "Campaign name"}
              </Label>
              <Input
                dir="auto"
                value={msgTitle}
                onChange={(e) => setMsgTitle(e.target.value)}
                placeholder={lang === "ar" ? "حملة سبتمبر" : "September campaign"}
                className="text-start"
              />
            </div>

            {/* ───── Recipient filters ───── */}
            <div dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-start">
              <div className="flex items-center justify-between gap-2">
                <Label className="block font-semibold">
                  {lang === "ar" ? "فلترة المستلمين" : "Recipient filters"}
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setMsgFilterCity("");
                    setMsgFilterKeyword("");
                    setMsgRequirePhone(false);
                    setMsgRequireProfile(false);
                    setMsgDedupe(true);
                    setMsgLimit(500);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  {lang === "ar" ? "إعادة ضبط" : "Reset"}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="block text-start text-xs">
                    {lang === "ar" ? "المدينة / المحافظة" : "City / Governorate"}
                  </Label>
                  <Input
                    dir="auto"
                    value={msgFilterCity}
                    onChange={(e) => setMsgFilterCity(e.target.value)}
                    placeholder={lang === "ar" ? "مثال: القاهرة" : "e.g. Cairo"}
                    className="h-9 text-start"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="block text-start text-xs">
                    {lang === "ar" ? "كلمات في الاسم/العمل (مفصولة بفاصلة)" : "Keywords in name/work (comma separated)"}
                  </Label>
                  <Input
                    dir="auto"
                    value={msgFilterKeyword}
                    onChange={(e) => setMsgFilterKeyword(e.target.value)}
                    placeholder={lang === "ar" ? "محمد, دكتور, مهندس" : "ahmed, doctor, engineer"}
                    className="h-9 text-start"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={msgRequirePhone} onCheckedChange={(v) => setMsgRequirePhone(!!v)} />
                  <span>{lang === "ar" ? "لديه رقم موبايل فقط" : "Has phone only"}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={msgRequireProfile} onCheckedChange={(v) => setMsgRequireProfile(!!v)} />
                  <span>{lang === "ar" ? "لديه بروفايل فيسبوك فقط" : "Has FB profile only"}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={msgDedupe} onCheckedChange={(v) => setMsgDedupe(!!v)} />
                  <span>{lang === "ar" ? "حذف المكرر" : "Dedupe"}</span>
                </label>
              </div>

              <div className="space-y-1">
                <Label className="block text-start text-xs">
                  {lang === "ar" ? `الحد الأقصى للمستلمين: ${msgLimit}` : `Recipient cap: ${msgLimit}`}
                </Label>
                <Slider value={[msgLimit]} min={10} max={2000} step={10} onValueChange={(v) => setMsgLimit(v[0])} />
              </div>

              {/* Preview */}
              <div className="grid grid-cols-1 gap-2 rounded-md border border-primary/20 bg-primary/5 p-2 text-center sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {lang === "ar" ? "المستلمون بعد الفلترة" : "After filters"}
                  </div>
                  <div className="text-lg font-bold tabular-nums text-primary">{filteredRows.length}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {lang === "ar" ? `من ${enrichedRows.length}` : `of ${enrichedRows.length}`}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {lang === "ar" ? "واتساب" : "WhatsApp"}
                  </div>
                  <div className="text-lg font-bold tabular-nums text-foreground">{filteredWaCount}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {lang === "ar" ? `من ${phoneCount}` : `of ${phoneCount}`}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {lang === "ar" ? "ماسنجر" : "Messenger"}
                  </div>
                  <div className="text-lg font-bold tabular-nums text-foreground">{filteredFbCount}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {lang === "ar" ? `من ${profileCount}` : `of ${profileCount}`}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={filteredRows.length === 0}
                  onClick={() => {
                    const headers = ["name","phone","profile","city","gov","declared","work"];
                    const esc = (v: any) => {
                      const s = v == null ? "" : String(v);
                      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                    };
                    const lines = [headers.join(",")];
                    for (const e of filteredRows) {
                      lines.push([
                        e.name ?? "",
                        e.phone ?? "",
                        e.profile || e.row.target || "",
                        e.city ?? "",
                        e.gov ?? "",
                        e.declared ?? "",
                        e.work ?? "",
                      ].map(esc).join(","));
                    }
                    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `recipients_${Date.now()}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="me-2 h-4 w-4" />
                  {lang === "ar" ? `تصدير المستلمين (${filteredRows.length})` : `Export recipients (${filteredRows.length})`}
                </Button>
              </div>
            </div>

            {/* Recipients preview list */}
            <PreviewList
              lang={lang}
              rows={filteredRows}
              search={previewSearch}
              setSearch={(v) => { setPreviewSearch(v); setPreviewPage(1); }}
              page={previewPage}
              setPage={setPreviewPage}
              pageSize={PREVIEW_PAGE_SIZE}
              isSystem={(p: string) => FB_SYSTEM_RE.test(p)}
              selectedKeys={msgSelectedRecipients}
              setSelectedKeys={setMsgSelectedRecipients}
              keyFor={recipientKey}
            />



            <div className="space-y-2">
              <Label className="block text-start">
                {lang === "ar" ? "القنوات" : "Channels"}
              </Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={msgChannels.whatsapp}
                    onCheckedChange={(v) => setMsgChannels((s) => ({ ...s, whatsapp: !!v }))}
                  />
                  <span>{lang === "ar" ? `واتساب (${filteredWaCount})` : `WhatsApp (${filteredWaCount})`}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={msgChannels.messenger}
                    onCheckedChange={(v) => setMsgChannels((s) => ({ ...s, messenger: !!v }))}
                  />
                  <span>{lang === "ar" ? `ماسنجر (${filteredFbCount})` : `Messenger (${filteredFbCount})`}</span>
                </label>
              </div>
            </div>


            <div className="space-y-2">
              <Label className="block text-start">
                {lang === "ar" ? "نص الرسالة" : "Message"}
              </Label>
              <Textarea
                dir="auto"
                rows={5}
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder={lang === "ar" ? "أهلاً {name}, ..." : "Hi {name}, ..."}
                className="text-start"
              />
              <p className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? "متاح: {name} يُستبدل باسم المستلم."
                  : "Available: {name} is replaced with recipient name."}
              </p>
            </div>

            {/* Image attachments (optional) */}
            {msgChannels.messenger && (
              <div className="space-y-2">
                <Label className="block text-start">
                  {lang === "ar" ? "صور مرفقة (اختياري)" : "Attached images (optional)"}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  {msgImages.map((url) => (
                    <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border">
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setMsgImages((p) => p.filter((u) => u !== url))}
                        className="absolute top-0 end-0 rounded-bl bg-black/60 p-0.5 text-white hover:bg-black/80"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-muted/50">
                    {msgUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleMsgImageUpload} disabled={msgUploading} />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "لو رفعت أكتر من صورة، البوت بيدوّر عليها لتجنّب الحظر."
                    : "If you upload multiple images, the bot rotates between them to reduce blocks."}
                </p>
              </div>
            )}

            {/* Multi-account selector for Messenger */}
            {msgChannels.messenger && (
              <div className="space-y-2">
                <Label className="block text-start">
                  {lang === "ar" ? "حسابات فيسبوك للإرسال (تدوير تلقائي)" : "Facebook accounts (auto-rotation)"}
                </Label>
                {msgAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {lang === "ar" ? "لا توجد حسابات نشطة. أضف حساب من صفحة حسابات البوت." : "No active accounts. Add one from the Bot Accounts page."}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setMsgSelectedAccounts(new Set(msgAccounts.map((a) => a.id)))}>
                        {lang === "ar" ? "اختر الكل" : "Select all"}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setMsgSelectedAccounts(new Set())}>
                        {lang === "ar" ? "مسح" : "Clear"}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {msgAccounts.map((a) => {
                        const on = msgSelectedAccounts.has(a.id);
                        return (
                          <button
                            type="button"
                            key={a.id}
                            onClick={() => setMsgSelectedAccounts((prev) => {
                              const n = new Set(prev);
                              if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                              return n;
                            })}
                            className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                          >
                            {on ? "✓ " : ""}{a.display_name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {lang === "ar"
                        ? `سيتم توزيع المستلمين بالتناوب (رسالة من كل حساب). المحدد: ${msgSelectedAccounts.size}/${msgAccounts.length}`
                        : `Recipients will round-robin across accounts. Selected: ${msgSelectedAccounts.size}/${msgAccounts.length}`}
                    </p>

                    {msgSelectedAccounts.size > 0 && (() => {
                      const globalSec = Math.max(36, Math.round(3600 / Math.max(1, msgPerHour)));
                      const N = msgSelectedAccounts.size;
                      const perAccountSec = Math.max(36, globalSec * N);
                      const perAccountMin = Math.floor(perAccountSec / 60);
                      const perAccountRem = perAccountSec % 60;
                      const selected = msgAccounts.filter((a) => msgSelectedAccounts.has(a.id));
                      return (
                        <div dir={lang === "ar" ? "rtl" : "ltr"} className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-start">
                          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <Clock className="h-4 w-4 text-primary" />
                            {lang === "ar" ? "توقيت الإرسال لكل حساب" : "Per-account send timing"}
                          </div>
                          <div className="mb-2 grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
                            <div className="rounded bg-background/60 p-2">
                              <div className="text-[10px] uppercase text-muted-foreground">{lang === "ar" ? "الفاصل العام" : "Global interval"}</div>
                              <div className="text-sm font-bold tabular-nums text-foreground">{globalSec}s</div>
                            </div>
                            <div className="rounded bg-background/60 p-2">
                              <div className="text-[10px] uppercase text-muted-foreground">{lang === "ar" ? "حسابات نشطة" : "Active accounts"}</div>
                              <div className="text-sm font-bold tabular-nums text-foreground">{N}</div>
                            </div>
                            <div className="rounded bg-background/60 p-2">
                              <div className="text-[10px] uppercase text-muted-foreground">{lang === "ar" ? "كل حساب يرسل كل" : "Each account every"}</div>
                              <div className="text-sm font-bold tabular-nums text-primary">{perAccountSec}s</div>
                            </div>
                          </div>
                          <ul className="space-y-1.5 text-xs">
                            {selected.map((a, idx) => {
                              const firstSendSec = idx * globalSec;
                              return (
                                <li key={a.id} className="grid gap-1 rounded border border-border/50 bg-background/40 px-2 py-1.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                  <span className="flex min-w-0 items-center gap-2 truncate">
                                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{idx + 1}</span>
                                    <span className="truncate font-medium text-foreground">{a.display_name}</span>
                                  </span>
                                  <span className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground sm:shrink-0">
                                    <span title={lang === "ar" ? "أول رسالة بعد بدء الحملة" : "First send after launch"}>
                                      ▶ {firstSendSec}s
                                    </span>
                                    <span className="text-border">·</span>
                                    <span className="font-medium text-foreground tabular-nums" title={lang === "ar" ? "الفاصل بين رسائل هذا الحساب" : "Interval between this account's messages"}>
                                      ⏱ {perAccountSec}s
                                    </span>
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                            {lang === "ar"
                              ? `كل حساب ينتظر ${perAccountMin > 0 ? `${perAccountMin}د ${perAccountRem}ث` : `${perAccountSec}ث`} بين رسائله، والمجموع يساوي ${msgPerHour} رسالة/ساعة موزّعة على كل الحسابات.`
                              : `Each account waits ${perAccountMin > 0 ? `${perAccountMin}m ${perAccountRem}s` : `${perAccountSec}s`} between its messages; combined throughput stays at ${msgPerHour} msg/hour across all accounts.`}
                          </p>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )}



            <div className="space-y-2">
              <Label className="block text-start">
                {lang === "ar" ? `سرعة الإرسال: ${msgPerHour} / ساعة` : `Send rate: ${msgPerHour} / hour`}
              </Label>
              <Slider
                value={[msgPerHour]}
                min={5}
                max={100}
                step={5}
                onValueChange={(v) => setMsgPerHour(v[0])}
              />
              <p className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? `≈ رسالة كل ${Math.round(3600 / Math.max(1, msgPerHour))} ثانية${msgSelectedAccounts.size > 1 ? ` (موزّعة على ${msgSelectedAccounts.size} حسابات → كل حساب يرسل كل ${Math.round((3600 / Math.max(1, msgPerHour)) * msgSelectedAccounts.size)} ثانية)` : ""}. كل ما قلّت السرعة كل ما قلّ احتمال الحظر.`
                  : `≈ one message every ${Math.round(3600 / Math.max(1, msgPerHour))}s${msgSelectedAccounts.size > 1 ? ` (split across ${msgSelectedAccounts.size} accounts → each waits ${Math.round((3600 / Math.max(1, msgPerHour)) * msgSelectedAccounts.size)}s)` : ""}. Lower rates reduce block risk.`}
              </p>
            </div>
          </div>

          <div className="grid shrink-0 gap-2 border-t bg-background px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-5 sm:py-4">
            <Button variant="outline" onClick={() => setMsgOpen(false)} disabled={msgSubmitting} className="w-full sm:w-auto">
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={launchMessaging} disabled={msgSubmitting || sendRows.length === 0} className="w-full min-w-0 justify-center gap-2 whitespace-normal break-words text-center leading-snug">
              {msgSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <Send className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                {msgSelectedRecipients.size > 0
                  ? (lang === "ar"
                      ? `إرسال للمحدد (${sendRows.length}) — واتساب ${sendWaCount} / ماسنجر ${sendFbCount}`
                      : `Send to selected (${sendRows.length}) — WA ${sendWaCount} / FB ${sendFbCount}`)
                  : (lang === "ar"
                      ? `إرسال للكل (${sendRows.length})`
                      : `Send to all (${sendRows.length})`)}
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>

  );
}

type PreviewRow = {
  name?: string | null;
  phone?: string | null;
  profile?: string | null;
  city?: string | null;
  gov?: string | null;
  declared?: string | null;
  work?: string | null;
  row: { target?: string | null };
};

function PreviewList({
  lang, rows, search, setSearch, page, setPage, pageSize, isSystem,
  selectedKeys, setSelectedKeys, keyFor,
}: {
  lang: string;
  rows: PreviewRow[];
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (n: number) => void;
  pageSize: number;
  isSystem: (p: string) => boolean;
  selectedKeys: Set<string>;
  setSelectedKeys: (s: Set<string>) => void;
  keyFor: (e: PreviewRow) => string;
}) {
  type SortKey = "name" | "city" | "gov";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [matchMode, setMatchMode] = useState<"any" | "all">("all");
  const [uniqueOnly, setUniqueOnly] = useState(false);

  const dupKeyFor = (e: PreviewRow) => {
    const phone = (e.phone ?? "").replace(/\D+/g, "");
    if (phone) return `p:${phone}`;
    const prof = (e.profile ?? e.row.target ?? "").trim().toLowerCase();
    if (prof) return `u:${prof}`;
    return `n:${(e.name ?? "").trim().toLowerCase()}`;
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortKey(null); setSortDir("asc"); }
  };

  // Advanced search: split by comma/whitespace, support "quoted phrase",
  // "-term" for exclusion, and field prefixes (name:, phone:, city:, gov:, profile:).
  type Token = { negate: boolean; text: string; field: "name" | "phone" | "city" | "gov" | "profile" | "any" };
  const tokens = useMemo<Token[]>(() => {
    const q = search.trim();
    if (!q) return [];
    const out: Token[] = [];
    const re = /-?(?:[a-z]+:)?(?:"[^"]+"|\S+)/gi;
    const matches = q.match(re) ?? [];
    for (const raw of matches) {
      let s = raw;
      const negate = s.startsWith("-");
      if (negate) s = s.slice(1);
      let field: Token["field"] = "any";
      const m = s.match(/^(name|phone|city|gov|profile):(.*)$/i);
      if (m) { field = m[1].toLowerCase() as Token["field"]; s = m[2]; }
      if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
      const text = s.trim().toLowerCase();
      if (text) out.push({ negate, text, field });
    }
    return out;
  }, [search]);

  const filtered = useMemo(() => {
    const base = tokens.length === 0 ? rows : rows.filter((e) => {
      const fields = {
        name: (e.name ?? "").toLowerCase(),
        phone: (e.phone ?? "").toString().toLowerCase(),
        city: (e.city ?? "").toLowerCase(),
        gov: (e.gov ?? "").toLowerCase(),
        profile: (e.profile ?? e.row.target ?? "").toLowerCase(),
        any: `${e.name ?? ""} ${e.phone ?? ""} ${e.profile ?? e.row.target ?? ""} ${e.city ?? ""} ${e.gov ?? ""} ${e.work ?? ""}`.toLowerCase(),
      };
      const positives = tokens.filter((t) => !t.negate);
      const negatives = tokens.filter((t) => t.negate);
      for (const t of negatives) if (fields[t.field].includes(t.text)) return false;
      if (positives.length === 0) return true;
      const check = (t: Token) => fields[t.field].includes(t.text);
      return matchMode === "all" ? positives.every(check) : positives.some(check);
    });
    if (!sortKey) return base;
    const collator = new Intl.Collator(lang === "ar" ? "ar" : "en", { sensitivity: "base", numeric: true });
    const sorted = [...base].sort((a, b) => {
      const av = (a[sortKey] ?? "").toString();
      const bv = (b[sortKey] ?? "").toString();
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return collator.compare(av, bv);
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [rows, tokens, matchMode, sortKey, sortDir, lang]);

  // Duplicate detection over the filtered list (by phone, then profile, then name).
  const dupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtered) {
      const k = dupKeyFor(e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [filtered]);
  const duplicatesCount = useMemo(() => {
    let n = 0;
    for (const c of dupCounts.values()) if (c > 1) n += c - 1;
    return n;
  }, [dupCounts]);

  const visible = useMemo(() => {
    if (!uniqueOnly) return filtered;
    const seen = new Set<string>();
    const out: PreviewRow[] = [];
    for (const e of filtered) {
      const k = dupKeyFor(e);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    return out;
  }, [filtered, uniqueOnly]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = visible.slice(start, start + pageSize);

  const filteredKeys = useMemo(() => visible.map(keyFor), [visible, keyFor]);
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selectedKeys.has(k));
  const someFilteredSelected = filteredKeys.some((k) => selectedKeys.has(k));

  const toggleOne = (k: string) => {
    const next = new Set(selectedKeys);
    if (next.has(k)) next.delete(k); else next.add(k);
    setSelectedKeys(next);
  };
  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedKeys);
      for (const k of filteredKeys) next.delete(k);
      setSelectedKeys(next);
    } else {
      const next = new Set(selectedKeys);
      for (const k of filteredKeys) next.add(k);
      setSelectedKeys(next);
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const SortableTh = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="px-2 py-1.5 text-start">
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${sortKey === k ? "text-foreground font-medium" : ""}`}
      >
        <span>{label}</span>
        <SortIcon k={k} />
      </button>
    </th>
  );

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="block text-start text-sm font-medium">
          {lang === "ar"
            ? `معاينة المستلمين (${visible.length}${uniqueOnly && filtered.length !== visible.length ? ` / ${filtered.length}` : ""})${selectedKeys.size > 0 ? ` — محدد: ${selectedKeys.size}` : ""}`
            : `Recipients preview (${visible.length}${uniqueOnly && filtered.length !== visible.length ? ` / ${filtered.length}` : ""})${selectedKeys.size > 0 ? ` — selected: ${selectedKeys.size}` : ""}`}
          {duplicatesCount > 0 && (
            <span className="ms-2 inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-normal text-amber-700 dark:text-amber-300">
              {lang === "ar" ? `مكررون: ${duplicatesCount}` : `Duplicates: ${duplicatesCount}`}
            </span>
          )}
        </Label>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant={uniqueOnly ? "default" : "outline"}
            className="h-8"
            onClick={() => setUniqueOnly(!uniqueOnly)}
            disabled={duplicatesCount === 0 && !uniqueOnly}
            title={lang === "ar" ? "إظهار النسخ الفريدة فقط" : "Show unique only"}
          >
            {uniqueOnly
              ? (lang === "ar" ? "عرض الكل" : "Show all")
              : (lang === "ar" ? `النسخ الفريدة فقط${duplicatesCount > 0 ? ` (-${duplicatesCount})` : ""}` : `Unique only${duplicatesCount > 0 ? ` (-${duplicatesCount})` : ""}`)}
          </Button>
          {selectedKeys.size > 0 && (
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setSelectedKeys(new Set())}>
              <X className="me-1 h-3.5 w-3.5" />
              {lang === "ar" ? "مسح التحديد" : "Clear selection"}
            </Button>
          )}
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setMatchMode("all")}
              className={`px-2 py-1 text-xs rounded ${matchMode === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              title={lang === "ar" ? "كل الكلمات يجب أن تتطابق" : "All terms must match"}
            >
              {lang === "ar" ? "كل الكلمات" : "AND"}
            </button>
            <button
              type="button"
              onClick={() => setMatchMode("any")}
              className={`px-2 py-1 text-xs rounded ${matchMode === "any" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              title={lang === "ar" ? "أي كلمة تتطابق" : "Any term matches"}
            >
              {lang === "ar" ? "أي كلمة" : "OR"}
            </button>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "ar" ? 'بحث متقدم: كلمات، "عبارة"، -استبعاد، city:القاهرة' : 'Advanced: words, "phrase", -exclude, city:Cairo'}
            className="h-8 w-72 max-w-full text-sm"
          />
        </div>
      </div>
      {tokens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>{lang === "ar" ? "المرشحات:" : "Filters:"}</span>
          {tokens.map((t, i) => (
            <span
              key={i}
              className={`px-1.5 py-0.5 rounded border ${t.negate ? "border-destructive/40 text-destructive" : "border-border"}`}
            >
              {t.negate ? "−" : ""}{t.field !== "any" ? `${t.field}:` : ""}{t.text}
            </span>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          {lang === "ar" ? "لا يوجد مستلمون مطابقون" : "No matching recipients"}
        </div>
      ) : (
        <>
          <div className="max-h-72 overflow-auto rounded-md border border-border bg-background">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-start w-8">
                    <Checkbox
                      checked={allFilteredSelected ? true : (someFilteredSelected ? "indeterminate" : false)}
                      onCheckedChange={toggleAllFiltered}
                      aria-label={lang === "ar" ? "تحديد الكل" : "Select all"}
                    />
                  </th>
                  <th className="px-2 py-1.5 text-start">#</th>
                  <SortableTh k="name" label={lang === "ar" ? "الاسم" : "Name"} />
                  <th className="px-2 py-1.5 text-start">{lang === "ar" ? "الهاتف" : "Phone"}</th>
                  <th className="px-2 py-1.5 text-start">{lang === "ar" ? "البروفايل" : "Profile"}</th>
                  <SortableTh k="city" label={lang === "ar" ? "المدينة" : "City"} />
                  <SortableTh k="gov" label={lang === "ar" ? "المحافظة" : "Governorate"} />
                </tr>
              </thead>
              <tbody>
                {slice.map((e, i) => {
                  const profile = e.profile || e.row.target || "";
                  const hasProfile = !!profile && !isSystem(profile);
                  const k = keyFor(e);
                  const checked = selectedKeys.has(k);
                  const dupCount = dupCounts.get(dupKeyFor(e)) ?? 1;
                  return (
                    <tr
                      key={start + i}
                      className={`border-t border-border/60 hover:bg-muted/30 ${checked ? "bg-primary/5" : ""} ${dupCount > 1 ? "bg-amber-500/5" : ""}`}
                    >
                      <td className="px-2 py-1.5">
                        <Checkbox checked={checked} onCheckedChange={() => toggleOne(k)} aria-label={e.name || ""} />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{start + i + 1}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span>{e.name || <span className="text-muted-foreground">—</span>}</span>
                          {dupCount > 1 && (
                            <span
                              className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0 text-[10px] text-amber-700 dark:text-amber-300"
                              title={lang === "ar" ? `يظهر ${dupCount} مرات` : `Appears ${dupCount} times`}
                            >
                              ×{dupCount}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-start">
                        {e.phone ? <bdi dir="ltr">{e.phone}</bdi> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5 max-w-[200px] truncate text-start">
                        {hasProfile ? (
                          <bdi dir="ltr"><a href={profile} target="_blank" rel="noreferrer" className="text-primary hover:underline">{profile}</a></bdi>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">{e.city || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5">{e.gov || <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>


          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {lang === "ar"
                ? `عرض ${start + 1}-${Math.min(start + pageSize, visible.length)} من ${visible.length}`
                : `Showing ${start + 1}-${Math.min(start + pageSize, visible.length)} of ${visible.length}`}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                {lang === "ar" ? "السابق" : "Prev"}
              </Button>
              <span className="tabular-nums">{safePage} / {totalPages}</span>
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                {lang === "ar" ? "التالي" : "Next"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


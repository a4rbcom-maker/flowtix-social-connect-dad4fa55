import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Users,
  Loader2,
  AlertCircle,
  KeyRound,
  Tag,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
  Copy,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  listMessengerPages,
  listMessengerContacts,
  getMessengerSyncStatus,
  startMessengerSync,
  sendMessengerBroadcast,
  updateMessengerContactTags,
} from "@/lib/messenger-contacts.functions";
import { connectFacebook } from "@/lib/facebook.functions";
import {
  listBotAccountsForMessenger,
  queueMessengerListPages,
  queueMessengerCookiesSync,
  getBotMessengerPages,
  getBotMessengerJob,
} from "@/lib/messenger-cookies.functions";
import { Cookie } from "lucide-react";

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

const MESSENGER_REQUIRED_SCOPES = ["pages_show_list", "pages_messaging"] as const;

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

type MessengerPageOption = {
  pageId: string;
  pageName: string;
  avatarUrl: string | null;
  source: "cookies" | "official";
};

function cleanPageName(name: string): string {
  if (!name) return name;
  return name
    .replace(/^\s*صورة\s+ملف\s+/u, "")
    .replace(/\s+الشخصية?$/u, "")
    .replace(/^\s*Profile\s+picture\s+of\s+/iu, "")
    .replace(/'s\s+profile\s+picture$/iu, "")
    .trim();
}

const FACEBOOK_COOKIES_SESSION_RE =
  /SESSION_EXPIRED|Facebook rejected|stored session cookies|redirected to login|checkpoint|c_user|cookies?.*(expired|invalid|rejected)|login/i;

function explainCookiesFailure(raw: string | null | undefined, lang: "ar" | "en") {
  const message = String(raw || "").trim();
  if (FACEBOOK_COOKIES_SESSION_RE.test(message)) {
    return lang === "ar"
      ? "لم تنجح عملية الاستخراج لأن فيسبوك رفض Cookies الحساب عند فتح صفحاتك. البوت يعمل، لكن جلسة الحساب نفسها منتهية أو غير مقبولة. الحل: افتح facebook.com بنفس الحساب، تأكد أنه لا يطلب Login/Checkpoint، صدّر Cookies جديدة من نفس المتصفح، ثم حدّث حساب البوت."
      : "Extraction failed because Facebook rejected this account's Cookies while opening your Pages. The bot is running, but the Facebook session itself is expired or not accepted. Open facebook.com with the same account, make sure there is no login/checkpoint, export fresh Cookies, then refresh the bot account.";
  }
  return message || (lang === "ar" ? "تعذّر تشغيل المهمة بهذا الحساب." : "Could not run this job with this account.");
}

function mergePageOptions(
  official: Array<{ pageId: string; pageName: string; avatarUrl: string | null }>,
  cookies: Array<{ pageId: string; pageName: string; avatarUrl: string | null }>,
): MessengerPageOption[] {
  const map = new Map<string, MessengerPageOption>();
  for (const p of cookies) map.set(p.pageId, { ...p, source: "cookies" });
  for (const p of official) if (!map.has(p.pageId)) map.set(p.pageId, { ...p, source: "official" });
  return Array.from(map.values());
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

function isStaleBotJob(job: { status?: string | null; created_at?: string | null } | null | undefined): boolean {
  if (!job || (job.status !== "running" && job.status !== "pending")) return false;
  const createdAt = job.created_at ? new Date(job.created_at).getTime() : 0;
  return createdAt > 0 && Date.now() - createdAt > 12 * 60 * 1000;
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
  const connectFacebookFn = useServerFn(connectFacebook);

  const [pageId, setPageId] = useState<string | null>(null);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [inlineToken, setInlineToken] = useState("");
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
  const [autoSyncStarted, setAutoSyncStarted] = useState<Set<string>>(new Set());
  const [tokenNotice, setTokenNotice] = useState<{
    kind: "missing_scopes" | "no_pages" | "saved";
    missing?: string[];
  } | null>(null);
  const [officialOpen, setOfficialOpen] = useState(false);

  // Pages query — decides whether to show picker.
  const pagesQ = useQuery({
    queryKey: ["msgr-pages", "official-managed-only"],
    enabled: officialOpen,
    queryFn: async () => {
      try {
        return await listPagesFn();
      } catch (err) {
        if (err instanceof Response) {
          const body = await err.clone().text().catch(() => "");
          throw new Error(
            body?.trim() ||
              (lang === "ar"
                ? `تعذر تحميل صفحاتك (${err.status})`
                : `Failed to load your Pages (${err.status})`),
          );
        }
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
    retry: false,
  });

  const pages = pagesQ.data ?? [];
  const noPagesReady = officialOpen && !pagesQ.isLoading && !pagesQ.error && pages.length === 0;

  const saveTokenM = useMutation({
    mutationFn: async (rawToken: string) => {
      const cleaned = rawToken.replace(/\s+/g, "");
      if (cleaned.length < 20) {
        throw new Error(lang === "ar" ? "الصق Facebook Access Token صحيح أولاً" : "Paste a valid Facebook Access Token first");
      }
      const res = await connectFacebookFn({ data: { access_token: cleaned } });
      const payload = ((res as { data?: unknown })?.data ?? res) as {
        success?: boolean;
        error?: { message?: string } | null;
        profile?: { name?: string } | null;
        granted?: string[];
      };
      if (payload?.success === false) {
        throw new Error(payload.error?.message || (lang === "ar" ? "فشل حفظ التوكن" : "Token save failed"));
      }
      return payload;
    },
    onSuccess: async (payload) => {
      toast.success(lang === "ar" ? "تم حفظ التوكن، جاري تحميل صفحاتك الآن" : "Token saved, loading your Pages now");
      setInlineToken("");
      const granted = new Set(payload.granted ?? []);
      const missing = MESSENGER_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
      if ((payload.granted?.length ?? 0) > 0 && missing.length > 0) {
        setTokenNotice({ kind: "missing_scopes", missing });
        toast.error(
          lang === "ar"
            ? `التوكن محفوظ لكن ناقص صلاحيات: ${missing.join(", ")}`
            : `Token saved but missing scopes: ${missing.join(", ")}`,
        );
      } else {
        setTokenNotice({ kind: "saved" });
      }
      const refreshed = await pagesQ.refetch();
      const count = refreshed.data?.length ?? 0;
      if (count > 0) {
        toast.success(lang === "ar" ? `تم العثور على ${count} صفحة مُدارة` : `Found ${count} managed Pages`);
        setTokenNotice(null);
      } else if (!refreshed.error && missing.length === 0) {
        setTokenNotice({ kind: "no_pages" });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Always make the user explicitly choose the target Page first.
  useEffect(() => {
    if (pageId) return;
    if (pages.length > 0) {
      setShowPagePicker(true);
    }
  }, [pageId, pages]);

  const [cookiesPages, setCookiesPages] = useState<
    Array<{ pageId: string; pageName: string; avatarUrl: string | null }>
  >([]);
  const cookiesPageIds = new Set(cookiesPages.map((p) => p.pageId));
  const allPageOptions = mergePageOptions(pages, cookiesPages);

  useEffect(() => {
    if (!officialOpen || !pageId || pagesQ.isLoading) return;
    if (cookiesPageIds.has(pageId)) return; // keep cookies-mode selection
    if (!pages.some((p) => p.pageId === pageId)) {
      setPageId(null);
      setSelected(new Set());
      setPage(1);
    }
  }, [officialOpen, pageId, pages, pagesQ.isLoading, cookiesPageIds]);


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
      startSyncFn({ data: { pageId: pageId!, mode, maxConversations: mode === "initial" ? 10000 : 300 } }),
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

  const currentPage = allPageOptions.find((p) => p.pageId === pageId);
  const selectedFromCookies = currentPage?.source === "cookies";
  const syncJob = statusQ.data?.job;
  const syncRunning = syncJob?.status === "running" || syncJob?.status === "queued";

  useEffect(() => {
    if (!pageId) return;
    if (selectedFromCookies) return; // Cookies-mode pages sync via the bot, not the official token
    if (autoSyncStarted.has(pageId)) return;
    if (!contactsQ.isSuccess || contactsQ.isFetching || syncM.isPending || syncRunning) return;
    if ((contactsQ.data?.total ?? 0) > 0) return;
    setAutoSyncStarted((prev) => new Set(prev).add(pageId));
    syncM.mutate("initial");
  }, [autoSyncStarted, contactsQ.data?.total, contactsQ.isFetching, contactsQ.isSuccess, pageId, selectedFromCookies, syncM, syncRunning]);

  const rtl = lang === "ar";
  const scopesText = MESSENGER_REQUIRED_SCOPES.join(",");
  const pagesErrorText = pagesQ.error instanceof Error ? pagesQ.error.message : pagesQ.error ? String(pagesQ.error) : "";
  const shouldShowPermissionSteps =
    tokenNotice?.kind === "missing_scopes" || /pages_show_list|pages_messaging|permission|الصلاحيات|صلاحية/i.test(pagesErrorText);

  const copyMessengerScopes = async () => {
    try {
      await navigator.clipboard.writeText(scopesText);
      toast.success(lang === "ar" ? "تم نسخ صلاحيات Messenger" : "Messenger scopes copied");
    } catch {
      toast.error(lang === "ar" ? "تعذر نسخ الصلاحيات" : "Could not copy scopes");
    }
  };

  const tokenConnectBox = (
    <div className="mx-auto mt-5 max-w-2xl rounded-xl border border-primary/20 bg-primary/5 p-4 text-start">
      <div className="mb-3 flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {lang === "ar" ? "ربط Messenger يتم بالتوكن فقط" : "Messenger connects with a token only"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lang === "ar"
              ? "الصق Facebook Access Token هنا وسنعرض الصفحات المُدارة من نفس الحساب فوراً. Cookies تخص حسابات البوت فقط ولا تجلب عملاء Messenger."
              : "Paste the Facebook Access Token here and managed Pages from the same account will appear immediately. Cookies are for bot accounts only and do not import Messenger contacts."}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          dir="ltr"
          type="password"
          value={inlineToken}
          onChange={(e) => setInlineToken(e.target.value)}
          placeholder="EAAB..."
          className="font-mono text-sm"
          disabled={saveTokenM.isPending}
        />
        <Button
          type="button"
          onClick={() => saveTokenM.mutate(inlineToken)}
          disabled={saveTokenM.isPending || !inlineToken.trim()}
          className="shrink-0"
        >
          {saveTokenM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {lang === "ar" ? "حفظ وجلب الصفحات" : "Save & load Pages"}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <Button type="button" variant="outline" size="sm" onClick={copyMessengerScopes}>
          <Copy className="h-3.5 w-3.5" />
          {lang === "ar" ? "نسخ صلاحيات Messenger" : "Copy Messenger scopes"}
        </Button>
        <a
          href="https://developers.facebook.com/tools/explorer/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-background px-3 py-1.5 font-semibold text-primary hover:bg-primary/10"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {lang === "ar" ? "فتح Graph API Explorer في نافذة جديدة لنسخ التوكن" : "Open Graph API Explorer in a new window to copy the token"}
        </a>
        <span className="text-muted-foreground">
          {lang === "ar" ? "ثم الصق التوكن الجديد هنا واضغط حفظ." : "Then paste the new token here and press save."}
        </span>
      </div>
      {shouldShowPermissionSteps && (
        <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-foreground">
          <p className="font-semibold">
            {lang === "ar" ? "الخطوة التالية المطلوبة" : "Required next step"}
          </p>
          <ol className="mt-2 list-decimal space-y-1 ps-5 text-muted-foreground">
            <li>{lang === "ar" ? "اضغط نسخ صلاحيات Messenger." : "Click Copy Messenger scopes."}</li>
            <li>
              {lang === "ar"
                ? "افتح Graph API Explorer، ثم من Add a Permission الصق الصلاحيات المنسوخة."
                : "Open Graph API Explorer, then paste the copied scopes in Add a Permission."}
            </li>
            <li>
              {lang === "ar"
                ? "اضغط Generate Access Token ووافق على الصفحات والرسائل، ثم الصق التوكن الجديد هنا."
                : "Click Generate Access Token, approve Pages and messages, then paste the new token here."}
            </li>
          </ol>
          <code className="mt-2 block select-all rounded-md bg-background px-2 py-1 font-mono text-[11px] text-foreground">
            {scopesText}
          </code>
        </div>
      )}
      {tokenNotice?.kind === "no_pages" && (
        <div className="mt-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
          {lang === "ar"
            ? "التوكن محفوظ لكن فيسبوك لم يرجع أي صفحات. تأكد أنك Admin أو Editor على صفحة واحدة على الأقل وأنك وافقت على pages_show_list."
            : "Token saved, but Facebook returned no Pages. Make sure you are Admin or Editor on at least one Page and approved pages_show_list."}
        </div>
      )}
    </div>
  );

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
          {allPageOptions.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowPagePicker(true)}>
              <Users className="h-4 w-4" />
              {currentPage ? cleanPageName(currentPage.pageName) : (lang === "ar" ? "اختر صفحة" : "Pick a page")}
            </Button>
          )}
          {!selectedFromCookies && (
            <Button
              size="sm"
              disabled={!pageId || syncM.isPending || syncRunning}
              onClick={() => syncM.mutate(total > 0 ? "incremental" : "initial")}
            >
              {syncM.isPending || syncRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {lang === "ar" ? "جلب/تحديث العملاء" : "Import/update contacts"}
            </Button>
          )}
        </div>
      </header>

      <CookiesModePanel
        lang={lang}
        onImportedContacts={(p) => {
          setCookiesPages((prev) =>
            prev.some((x) => x.pageId === p.pageId) ? prev : [...prev, p],
          );
          setPageId(p.pageId);
          setSelected(new Set());
          setPage(1);
          qc.invalidateQueries({ queryKey: ["msgr-contacts", p.pageId] });
        }}
      />

      {/* Gate: pages exist but none selected */}
      {officialOpen && !pagesQ.isLoading && pages.length > 0 && !pageId && (
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
                {lang === "ar" ? "إعادة مراسلة المحددين" : "Message selected again"}
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
                <th className="p-3 text-start">{lang === "ar" ? "مراسلة" : "Message"}</th>
              </tr>
            </thead>
            <tbody>
              {contactsQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    {lang === "ar"
                      ? syncM.isPending || syncRunning
                        ? "جاري جلب أسماء من تواصلوا مع هذه الصفحة عبر Messenger..."
                        : "لا توجد أسماء بعد لهذه الصفحة. سيتم الجلب تلقائياً عند اختيار الصفحة، ويمكنك الضغط على \"جلب/تحديث العملاء\" لإعادة المحاولة."
                      : syncM.isPending || syncRunning
                        ? "Importing everyone who messaged this Page..."
                        : "No contacts yet for this Page. Import starts automatically after choosing the Page; you can retry with Import/update contacts."}
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
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected(new Set([c.id]));
                          setCampaignOpen(true);
                        }}
                      >
                        <Send className="h-4 w-4" />
                        {lang === "ar" ? "مراسلة" : "Message"}
                      </Button>
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
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {lang === "ar" ? "اختر الصفحة" : "Pick a page"}
            </DialogTitle>
            <DialogDescription>
              {lang === "ar"
                ? "تظهر هنا صفحاتك المُدارة فقط التي لديها صلاحية Messenger. اختر صفحة واحدة لجلب أسماء من تواصلوا معها."
                : "Only managed Pages with Messenger access appear here. Pick one Page to import its contacts."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto flex-1 pr-1">
            {allPageOptions.map((p) => (
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
                  <div className="font-medium">{cleanPageName(p.pageName)}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">
                      {p.source === "cookies"
                        ? lang === "ar" ? "من Cookies" : "From Cookies"
                        : lang === "ar" ? "من التوكن" : "From token"}
                    </Badge>
                    <span>{p.pageId}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPagePicker(false)}>
              {lang === "ar" ? "إغلاق" : "Close"}
            </Button>
          </DialogFooter>
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

// ------------------------------------------------------------
// Cookies mode panel: alternative to the official Access Token.
// Uses an existing bot Cookies account to list managed Pages, then
// import Messenger contacts for a selected Page via the bot worker.
// ------------------------------------------------------------
function CookiesModePanel(props: {
  lang: "ar" | "en";
  onImportedContacts: (p: { pageId: string; pageName: string; avatarUrl: string | null }) => void;
}) {
  const { lang, onImportedContacts } = props;
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [activeSyncPageId, setActiveSyncPageId] = useState<string | null>(null);

  const listAccountsFn = useServerFn(listBotAccountsForMessenger);
  const listPagesFn = useServerFn(queueMessengerListPages);
  const syncCookiesFn = useServerFn(queueMessengerCookiesSync);
  const getPagesFn = useServerFn(getBotMessengerPages);
  const getJobFn = useServerFn(getBotMessengerJob);

  const accountsQ = useQuery({
    queryKey: ["cookies-bot-accounts"],
    enabled: open,
    queryFn: () => listAccountsFn(),
  });
  const accounts = accountsQ.data ?? [];
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const canRunWithSelectedAccount = !!selectedAccount && selectedAccount.status === "active";
  const selectedAccountFailure = selectedAccount ? explainCookiesFailure(selectedAccount.lastError, lang) : "";

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId((activeAccounts[0] ?? accounts[0]).id);
  }, [accountId, accounts]);

  const listPagesJobQ = useQuery({
    queryKey: ["cookies-list-pages-job", accountId],
    enabled: open && !!accountId,
    queryFn: () => getJobFn({ data: { accountId: accountId!, jobType: "messenger_list_pages" } }),
    refetchInterval: (q) => {
      const s = (q.state.data as { job?: { status?: string } } | undefined)?.job?.status;
      return s === "running" || s === "pending" ? 3000 : false;
    },
  });
  const pagesResultQ = useQuery({
    queryKey: ["cookies-pages-result", accountId, listPagesJobQ.data?.job?.status],
    enabled: open && !!accountId && listPagesJobQ.data?.job?.status === "completed",
    queryFn: () => getPagesFn({ data: { accountId: accountId! } }),
  });
  const syncJobQ = useQuery({
    queryKey: ["cookies-sync-job", accountId, activeSyncPageId],
    enabled: open && !!accountId && !!activeSyncPageId,
    queryFn: () => getJobFn({ data: { accountId: accountId!, jobType: "messenger_sync_cookies", pageId: activeSyncPageId! } }),
    refetchInterval: (q) => {
      const s = (q.state.data as { job?: { status?: string } } | undefined)?.job?.status;
      return s === "running" || s === "pending" ? 3000 : false;
    },
  });

  const pages = pagesResultQ.data?.pages ?? [];
  const listJob = listPagesJobQ.data?.job;
  const syncJob = syncJobQ.data?.job;
  const listStale = isStaleBotJob(listJob);
  const syncStale = isStaleBotJob(syncJob);
  const listRunning = !listStale && (listJob?.status === "running" || listJob?.status === "pending");
  const syncRunning = !syncStale && (syncJob?.status === "running" || syncJob?.status === "pending");
  const listFailureText = listJob?.status === "failed" ? explainCookiesFailure(listJob.error_message, lang) : "";
  const syncFailureText = syncJob?.status === "failed" ? explainCookiesFailure(syncJob.error_message, lang) : "";

  useEffect(() => {
    if (listJob?.status === "failed" || syncJob?.status === "failed") accountsQ.refetch();
  }, [listJob?.status, syncJob?.status]);

  const startListPagesM = useMutation({
    mutationFn: () => listPagesFn({ data: { accountId: accountId! } }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم إرسال طلب جلب الصفحات للـ Bot" : "List-pages job queued to the bot");
      listPagesJobQ.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [lastSyncedPage, setLastSyncedPage] = useState<{ pageId: string; pageName: string } | null>(null);
  const startSyncM = useMutation({
    mutationFn: (p: { pageId: string; pageName: string }) =>
      syncCookiesFn({ data: { accountId: accountId!, pageId: p.pageId, pageName: p.pageName } }),
    onSuccess: (_d, vars) => {
      setLastSyncedPage(vars);
      setActiveSyncPageId(vars.pageId);
      onImportedContacts({ pageId: vars.pageId, pageName: vars.pageName, avatarUrl: null });
      toast.success(lang === "ar" ? "بدأت مزامنة المحادثات — سيتم فتح قائمة العملاء تلقائياً عند الانتهاء" : "Sync started — contacts will open automatically");
      syncJobQ.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-open contacts view when sync completes
  useEffect(() => {
    if (syncJob?.status === "completed" && lastSyncedPage) {
      onImportedContacts({ pageId: lastSyncedPage.pageId, pageName: lastSyncedPage.pageName, avatarUrl: null });
      qc.invalidateQueries({ queryKey: ["msgr-contacts", lastSyncedPage.pageId] });
      setLastSyncedPage(null);
    }
  }, [syncJob?.status, lastSyncedPage, onImportedContacts, qc]);




  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-start"
      >
        <div className="flex items-center gap-2">
          <Cookie className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold">
            {lang === "ar"
              ? "طريقة بديلة: استخدام حساب Cookies للبوت (بدون توكن رسمي)"
              : "Alternative: use a bot Cookies account (no official token)"}
          </span>
        </div>
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            {lang === "ar"
              ? "المسار الأساسي هنا: اختر حساب Cookies صالح ثم اضغط جلب الصفحات. إذا رفض فيسبوك الجلسة فلن تظهر صفحات حتى تحدّث Cookies الحساب."
              : "Less stable than the official token and the bot session may drop, but no Meta approval is needed. The bot account must be Active."}
          </p>

          {accountsQ.isLoading ? (
            <div className="text-xs text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /> …</div>
          ) : accounts.length === 0 ? (
            <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
              {lang === "ar"
                ? "لا يوجد أي حساب بوت مربوط. أضف حساب Cookies من صفحة (حسابات البوت) أولاً."
                : "No bot account linked. Add a Cookies account from the Bot Accounts page first."}
            </div>
          ) : (
            <>
              {activeAccounts.length === 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>
                    {lang === "ar" ? "كل حسابات البوت لديك منتهية الجلسة" : "All your bot accounts have expired sessions"}
                  </AlertTitle>
                  <AlertDescription className="space-y-2 text-xs">
                    <p>
                      {lang === "ar"
                        ? "الخدمة تعمل بشكل صحيح، لكن فيسبوك رفض Cookies جميع الحسابات المربوطة. يجب تحديث Cookies حساب واحد على الأقل قبل أن يظهر أي شيء هنا."
                        : "The service works — Facebook rejected the Cookies of all your linked accounts. Refresh the Cookies of at least one account first."}
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/dashboard/facebook/bot">
                        {lang === "ar" ? "الذهاب لتحديث Cookies الآن" : "Go refresh Cookies now"}
                      </Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Select value={accountId ?? undefined} onValueChange={(v) => setAccountId(v)}>
                  <SelectTrigger className="h-9 w-72">
                    <SelectValue placeholder={lang === "ar" ? "اختر حساب البوت" : "Pick bot account"} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => {
                      const ok = a.status === "active";
                      const statusLabel = ok
                        ? (lang === "ar" ? "متصل" : "Active")
                        : (lang === "ar" ? "جلسة منتهية" : "Expired");
                      return (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="inline-flex items-center gap-2">
                            <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
                            <span>{a.displayName}</span>
                            <span className={`text-[10px] ${ok ? "text-green-600" : "text-red-600"}`}>({statusLabel})</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedAccount && (
                  <Badge variant={canRunWithSelectedAccount ? "default" : "destructive"} className="text-[10px]">
                    <span className={`me-1 inline-block h-2 w-2 rounded-full ${canRunWithSelectedAccount ? "bg-green-400" : "bg-red-300"}`} />
                    {canRunWithSelectedAccount
                      ? lang === "ar" ? "جلسة صالحة" : "Session active"
                      : lang === "ar" ? "الجلسة منتهية — حدّث Cookies" : "Session expired — refresh Cookies"}
                  </Badge>
                )}
                <Button
                  size="sm"
                  disabled={!accountId || !canRunWithSelectedAccount || startListPagesM.isPending || listRunning}
                  onClick={() => startListPagesM.mutate()}
                >
                  {startListPagesM.isPending || listRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {!canRunWithSelectedAccount && selectedAccount
                    ? lang === "ar" ? "حدّث Cookies أولاً" : "Refresh Cookies first"
                    : lang === "ar" ? "جلب صفحاتي المدارة" : "Fetch my managed Pages"}
                </Button>
                {listJob && (
                  <Badge variant="outline" className="text-[10px]">
                    {lang === "ar" ? "حالة الجلب" : "List job"}: {listJob.status}
                    {typeof listJob.progress === "number" ? ` — ${listJob.progress}%` : ""}
                    {listStale ? (lang === "ar" ? " — متوقفة" : " — stale") : ""}
                  </Badge>
                )}
              </div>
            </>
          )}

          {selectedAccount && !canRunWithSelectedAccount && activeAccounts.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{lang === "ar" ? "جلسة هذا الحساب منتهية" : "This account's session expired"}</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <p>{selectedAccountFailure}</p>
                <Button asChild size="sm" variant="outline">
                  <Link to="/dashboard/facebook/bot">
                    {lang === "ar" ? "تحديث Cookies الحساب" : "Refresh account Cookies"}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {listJob?.status === "failed" && canRunWithSelectedAccount && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{lang === "ar" ? "فشلت آخر محاولة جلب" : "Latest fetch attempt failed"}</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <p>{listFailureText}</p>
              </AlertDescription>
            </Alert>
          )}

          {listStale && canRunWithSelectedAccount && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{lang === "ar" ? "مهمة جلب الصفحات توقفت" : "Page fetch stalled"}</AlertTitle>
              <AlertDescription className="text-xs">
                {lang === "ar"
                  ? "لن نترك الواجهة على جاري الجلب. اضغط جلب صفحاتي المدارة مرة أخرى؛ إذا تكررت فالعامل على السيرفر يحتاج إعادة تشغيل."
                  : "The UI will not stay loading forever. Try fetching Pages again; if it repeats, restart the server worker."}
              </AlertDescription>
            </Alert>
          )}

          {pages.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">
                {lang === "ar" ? "الصفحات المكتشفة" : "Discovered Pages"} ({pages.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {pages.map((p) => {
                  const isActive =
                    (startSyncM.isPending && startSyncM.variables?.pageId === p.pageId) ||
                    (syncRunning && lastSyncedPage?.pageId === p.pageId);
                  return (
                    <button
                      type="button"
                      key={p.pageId}
                      disabled={!accountId || startSyncM.isPending || syncRunning}
                      onClick={() => {
                        setActiveSyncPageId(p.pageId);
                        setLastSyncedPage({ pageId: p.pageId, pageName: p.pageName });
                        startSyncM.mutate({ pageId: p.pageId, pageName: p.pageName });
                      }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-3 text-xs text-start transition hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{cleanPageName(p.pageName)}</p>
                        <p className="truncate text-muted-foreground">{p.pageId}</p>
                      </div>
                      <div className="flex items-center gap-1 text-primary font-medium whitespace-nowrap">
                        {isActive ? (
                          <>
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            {lang === "ar" ? "جارٍ الجلب…" : "Loading…"}
                          </>
                        ) : (
                          <>
                            <Users className="h-3 w-3" />
                            {lang === "ar" ? "جلب العملاء" : "Fetch contacts"}
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {syncJob && (
                <div className="rounded-lg border border-border bg-background p-2 text-xs">
                  {lang === "ar" ? "آخر مزامنة عملاء" : "Last sync"}: {syncJob.status}
                  {typeof syncJob.progress === "number" ? ` — ${syncJob.progress}%` : ""}
                  {syncStale ? (lang === "ar" ? " — متوقفة" : " — stale") : ""}
                  {typeof syncJob.processed_items === "number"
                    ? ` (${syncJob.processed_items}/${syncJob.total_items ?? "?"})`
                    : ""}
                  {syncJob.error_message ? ` — ${syncFailureText}` : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

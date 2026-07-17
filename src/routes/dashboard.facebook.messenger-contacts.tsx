import { createFileRoute } from "@tanstack/react-router";
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
import { connectFacebook } from "@/lib/facebook.functions";

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

  // Pages query — decides whether to show picker.
  const pagesQ = useQuery({
    queryKey: ["msgr-pages", "official-managed-only"],
    queryFn: () => listPagesFn(),
  });

  const pages = pagesQ.data ?? [];
  const noPagesReady = !pagesQ.isLoading && !pagesQ.error && pages.length === 0;

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
      };
      if (payload?.success === false) {
        throw new Error(payload.error?.message || (lang === "ar" ? "فشل حفظ التوكن" : "Token save failed"));
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(lang === "ar" ? "تم حفظ التوكن، جاري تحميل صفحاتك الآن" : "Token saved, loading your Pages now");
      setInlineToken("");
      const refreshed = await pagesQ.refetch();
      const count = refreshed.data?.length ?? 0;
      if (count > 0) {
        toast.success(lang === "ar" ? `تم العثور على ${count} صفحة مُدارة` : `Found ${count} managed Pages`);
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

  useEffect(() => {
    if (!pageId || pagesQ.isLoading) return;
    if (!pages.some((p) => p.pageId === pageId)) {
      setPageId(null);
      setSelected(new Set());
      setPage(1);
    }
  }, [pageId, pages, pagesQ.isLoading]);


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

  const currentPage = pages.find((p) => p.pageId === pageId);
  const syncJob = statusQ.data?.job;
  const syncRunning = syncJob?.status === "running" || syncJob?.status === "queued";

  useEffect(() => {
    if (!pageId) return;
    if (autoSyncStarted.has(pageId)) return;
    if (!contactsQ.isSuccess || contactsQ.isFetching || syncM.isPending || syncRunning) return;
    if ((contactsQ.data?.total ?? 0) > 0) return;
    setAutoSyncStarted((prev) => new Set(prev).add(pageId));
    syncM.mutate("initial");
  }, [autoSyncStarted, contactsQ.data?.total, contactsQ.isFetching, contactsQ.isSuccess, pageId, syncM, syncRunning]);

  const rtl = lang === "ar";

  const tokenConnectBox = (
    <div className="mx-auto mt-5 max-w-2xl rounded-xl border border-primary/20 bg-primary/5 p-4 text-start">
      <div className="mb-3 flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            {lang === "ar" ? "الصق التوكن هنا مباشرة" : "Paste the token here directly"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {lang === "ar"
              ? "بعد الحفظ سنعرض الصفحات المُدارة من نفس الحساب فوراً، بدون الانتقال لأي شاشة أخرى."
              : "After saving, managed Pages from the same account will appear here immediately."}
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
          {pages.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowPagePicker(true)}>
              <Users className="h-4 w-4" />
              {currentPage?.pageName ?? (lang === "ar" ? "اختر صفحة" : "Pick a page")}
            </Button>
          )}
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
          {tokenConnectBox}
        </Card>
      )}

      {/* Gate: no pages linked */}
      {noPagesReady && (
        <Card className="p-8 text-center">
          <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold">
            {lang === "ar" ? "لا توجد صفحات من التوكن الحالي" : "No Pages from the current token"}
          </h2>
          <p className="mx-auto mb-5 max-w-2xl text-sm text-muted-foreground">
            {lang === "ar"
              ? "هذه الشاشة تعتمد على التوكن فقط. الصق التوكن هنا وسنعرض أسماء الصفحات المُدارة فوراً لتختار الصفحة وتبدأ جلب عملاء Messenger."
              : "This screen uses the token only. Paste it here and managed Page names will appear immediately so you can pick a Page and import Messenger contacts."}
          </p>
          {tokenConnectBox}
          <Button className="mt-3" variant="outline" onClick={() => pagesQ.refetch()}>
            <RefreshCw className="h-4 w-4" />
            {lang === "ar" ? "إعادة تحميل الصفحات" : "Reload Pages"}
          </Button>
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
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">
                      {lang === "ar" ? "صفحة مُدارة" : "Managed Page"}
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Inbox,
  Download,
  Eye,
  RefreshCw,
  MessageSquare,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  fetchFacebookPages,
  fetchPageConversations,
  fetchConversationMessages,
  extractLeadsFromConversations,
} from "@/lib/facebook.functions";

export const Route = createFileRoute("/dashboard/facebook/messages")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: MessagesPage,
});

type Page = { id: string; name: string };
type Conversations = Awaited<ReturnType<typeof fetchPageConversations>>;
type Leads = Awaited<ReturnType<typeof extractLeadsFromConversations>>;
type Messages = Awaited<ReturnType<typeof fetchConversationMessages>>;

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join(
    "\n",
  );
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDate(iso: string | null, ar: boolean) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(ar ? "ar-EG" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const listPagesFn = useServerFn(fetchFacebookPages);
  const fetchConvsFn = useServerFn(fetchPageConversations);
  const fetchMsgsFn = useServerFn(fetchConversationMessages);
  const extractLeadsFn = useServerFn(extractLeadsFromConversations);

  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [loadingPages, setLoadingPages] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);

  const [convs, setConvs] = useState<Conversations | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [leads, setLeads] = useState<Leads | null>(null);
  const [loadingLeads, setLoadingLeads] = useState(false);

  const [openConv, setOpenConv] = useState<{ id: string; name: string } | null>(null);
  const [msgs, setMsgs] = useState<Messages | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const t = ar
    ? {
        title: "رسائل Inbox",
        subtitle:
          "محادثات Messenger الخاصة بصفحتك وبيانات العملاء المهتمين — يتطلب صلاحية pages_messaging",
        selectPage: "اختر الصفحة",
        noPages: "لا توجد صفحات. تأكد من ربط الحساب ووجود صلاحية pages_show_list.",
        backToConnect: "→ صفحة الربط",
        loading: "جاري التحميل…",
        refresh: "تحديث",
        loadMore: "تحميل المزيد",
        export: "تصدير CSV",
        tabConvs: "المحادثات",
        tabLeads: "العملاء المهتمين",
        tabStats: "إحصائيات",
        colParticipant: "العميل",
        colSnippet: "آخر رسالة",
        colUpdated: "آخر تحديث",
        colMsgs: "رسائل",
        colUnread: "غير مقروء",
        colStatus: "الحالة",
        colActions: "إجراء",
        colPsid: "PSID",
        view: "عرض",
        statTotalConvs: "إجمالي المحادثات",
        statUnread: "غير مقروء",
        statTotalMsgs: "إجمالي الرسائل",
        statAvgMsgs: "متوسط الرسائل/محادثة",
        empty: "لا توجد محادثات بعد. الصفحات الجديدة قد لا ترجع بيانات إلا بعد أول رسالة.",
        statusUnread: "غير مقروء",
        statusReplied: "تم الرد",
        permWarning:
          "إذا كانت النتائج فارغة، تأكد إن التوكن متضمن صلاحية pages_messaging وأن الصفحة في وضع Live.",
        msgsTitle: "آخر الرسائل",
        msgsEmpty: "لا توجد رسائل.",
        you: "أنت (الصفحة)",
      }
    : {
        title: "Messenger Inbox",
        subtitle:
          "Page Messenger conversations and lead data — requires the pages_messaging scope.",
        selectPage: "Select page",
        noPages: "No pages found. Ensure your account is linked with pages_show_list.",
        backToConnect: "→ Connection page",
        loading: "Loading…",
        refresh: "Refresh",
        loadMore: "Load more",
        export: "Export CSV",
        tabConvs: "Conversations",
        tabLeads: "Leads",
        tabStats: "Stats",
        colParticipant: "Customer",
        colSnippet: "Last message",
        colUpdated: "Last updated",
        colMsgs: "Messages",
        colUnread: "Unread",
        colStatus: "Status",
        colActions: "Action",
        colPsid: "PSID",
        view: "View",
        statTotalConvs: "Total conversations",
        statUnread: "Unread",
        statTotalMsgs: "Total messages",
        statAvgMsgs: "Avg msgs / conversation",
        empty: "No conversations yet. New pages may not return data until the first message.",
        statusUnread: "Unread",
        statusReplied: "Replied",
        permWarning:
          "If results are empty, make sure your token includes pages_messaging and the page is in Live mode.",
        msgsTitle: "Recent messages",
        msgsEmpty: "No messages.",
        you: "You (Page)",
      };

  // Load pages
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      setLoadingPages(true);
      setPagesError(null);
      try {
        const res = await listPagesFn();
        if (cancelled) return;
        if (!res.ok) {
          setPagesError(res.error?.message ?? "Failed to load pages");
          setPages([]);
        } else {
          const list = (res.pages ?? []) as Page[];
          setPages(list);
          if (list.length > 0) setPageId(list[0].id);
        }
      } catch (e) {
        if (!cancelled) setPagesError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingPages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, listPagesFn]);

  const loadConversations = async (append = false) => {
    if (!pageId) return;
    setLoadingConvs(true);
    try {
      const res = await fetchConvsFn({
        data: { pageId, limit: 25, after: append ? nextCursor ?? undefined : undefined },
      });
      if (!res.ok) {
        toast.error(res.error?.message ?? "Error");
        setConvs(res);
        return;
      }
      if (append && convs?.ok) {
        setConvs({
          ...res,
          conversations: [...convs.conversations, ...res.conversations],
        });
      } else {
        setConvs(res);
      }
      setNextCursor(res.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingConvs(false);
    }
  };

  const loadLeads = async () => {
    if (!pageId) return;
    setLoadingLeads(true);
    try {
      const res = await extractLeadsFn({ data: { pageId, max: 100 } });
      if (!res.ok) toast.error(res.error?.message ?? "Error");
      setLeads(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLeads(false);
    }
  };

  // Auto-load when pageId changes
  useEffect(() => {
    if (!pageId) return;
    setConvs(null);
    setLeads(null);
    setNextCursor(null);
    void loadConversations(false);
    void loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const openConversation = async (id: string, name: string) => {
    setOpenConv({ id, name });
    setMsgs(null);
    setLoadingMsgs(true);
    try {
      const res = await fetchMsgsFn({
        data: { pageId, conversationId: id, limit: 50 },
      });
      setMsgs(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMsgs(false);
    }
  };

  const exportLeads = () => {
    if (!leads?.ok || leads.leads.length === 0) return;
    downloadCsv(
      `messenger-leads-${pageId}-${Date.now()}.csv`,
      leads.leads.map((l) => ({
        name: l.name,
        psid: l.psid,
        last_snippet: l.lastSnippet,
        last_interaction: l.lastInteraction ?? "",
        message_count: l.messageCount,
        unread: l.unreadCount,
        status: l.status,
      })),
    );
  };

  const totals = leads?.ok ? leads.totals : null;
  const avgMsgs =
    totals && totals.conversations > 0
      ? Math.round((totals.totalMessages / totals.conversations) * 10) / 10
      : 0;

  if (authLoading || loadingPages) {
    return (
      <DashboardLayout title={t.title}>
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (pagesError || pages.length === 0) {
    return (
      <DashboardLayout title={t.title}>
        <Card className="p-10 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="mb-4 text-muted-foreground">{pagesError ?? t.noPages}</p>
          <Link to="/dashboard/facebook">
            <Button>{t.backToConnect}</Button>
          </Link>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <Inbox className="h-6 w-6 text-primary" />
              {t.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void loadConversations(false);
              void loadLeads();
            }}
            disabled={loadingConvs || loadingLeads}
          >
            <RefreshCw
              className={`me-2 h-4 w-4 ${loadingConvs || loadingLeads ? "animate-spin" : ""}`}
            />
            {t.refresh}
          </Button>
        </div>

        <Card className="p-4">
          <label className="mb-2 block text-sm font-medium">{t.selectPage}</label>
          <Select value={pageId} onValueChange={setPageId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Card>

        {/* Permission warning */}
        {(convs?.ok === false || leads?.ok === false) && (
          <Card className="border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <div className="text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  {convs?.error?.message ?? leads?.error?.message}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t.permWarning}</p>
              </div>
            </div>
          </Card>
        )}

        <Tabs defaultValue="convs">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="convs">
              <MessageSquare className="me-2 h-4 w-4" />
              {t.tabConvs}
            </TabsTrigger>
            <TabsTrigger value="leads">
              <Users className="me-2 h-4 w-4" />
              {t.tabLeads}
            </TabsTrigger>
            <TabsTrigger value="stats">
              <Inbox className="me-2 h-4 w-4" />
              {t.tabStats}
            </TabsTrigger>
          </TabsList>

          {/* Conversations */}
          <TabsContent value="convs">
            <Card className="p-4">
              {loadingConvs && !convs ? (
                <div className="flex items-center justify-center p-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : convs?.ok && convs.conversations.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t.empty}</p>
              ) : convs?.ok ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.colParticipant}</TableHead>
                        <TableHead>{t.colSnippet}</TableHead>
                        <TableHead>{t.colUpdated}</TableHead>
                        <TableHead className="text-center">{t.colMsgs}</TableHead>
                        <TableHead className="text-center">{t.colUnread}</TableHead>
                        <TableHead className="text-end">{t.colActions}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {convs.conversations.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.participantName}</TableCell>
                          <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                            {c.snippet}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(c.updatedTime, ar)}
                          </TableCell>
                          <TableCell className="text-center">{c.messageCount}</TableCell>
                          <TableCell className="text-center">
                            {c.unreadCount > 0 ? (
                              <Badge variant="default">{c.unreadCount}</Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openConversation(c.id, c.participantName)}
                            >
                              <Eye className="me-1 h-3.5 w-3.5" />
                              {t.view}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {nextCursor && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="outline"
                        onClick={() => void loadConversations(true)}
                        disabled={loadingConvs}
                      >
                        {loadingConvs && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        {t.loadMore}
                      </Button>
                    </div>
                  )}
                </>
              ) : null}
            </Card>
          </TabsContent>

          {/* Leads */}
          <TabsContent value="leads">
            <Card className="p-4">
              <div className="mb-3 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportLeads}
                  disabled={!leads?.ok || leads.leads.length === 0}
                >
                  <Download className="me-2 h-4 w-4" />
                  {t.export}
                </Button>
              </div>
              {loadingLeads && !leads ? (
                <div className="flex items-center justify-center p-10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : leads?.ok && leads.leads.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{t.empty}</p>
              ) : leads?.ok ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.colParticipant}</TableHead>
                      <TableHead className="font-mono text-xs">{t.colPsid}</TableHead>
                      <TableHead>{t.colUpdated}</TableHead>
                      <TableHead className="text-center">{t.colMsgs}</TableHead>
                      <TableHead>{t.colStatus}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.leads.map((l) => (
                      <TableRow key={l.conversationId}>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {l.psid}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(l.lastInteraction, ar)}
                        </TableCell>
                        <TableCell className="text-center">{l.messageCount}</TableCell>
                        <TableCell>
                          {l.status === "unread" ? (
                            <Badge variant="default">{t.statusUnread}</Badge>
                          ) : (
                            <Badge variant="secondary">{t.statusReplied}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </Card>
          </TabsContent>

          {/* Stats */}
          <TabsContent value="stats">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-5">
                <p className="text-xs text-muted-foreground">{t.statTotalConvs}</p>
                <p className="mt-2 text-3xl font-bold">{totals?.conversations ?? 0}</p>
              </Card>
              <Card className="p-5">
                <p className="text-xs text-muted-foreground">{t.statUnread}</p>
                <p className="mt-2 text-3xl font-bold text-primary">{totals?.unread ?? 0}</p>
              </Card>
              <Card className="p-5">
                <p className="text-xs text-muted-foreground">{t.statTotalMsgs}</p>
                <p className="mt-2 text-3xl font-bold">{totals?.totalMessages ?? 0}</p>
              </Card>
              <Card className="p-5">
                <p className="text-xs text-muted-foreground">{t.statAvgMsgs}</p>
                <p className="mt-2 text-3xl font-bold">{avgMsgs}</p>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Conversation messages dialog */}
      <Dialog open={!!openConv} onOpenChange={(o) => !o && setOpenConv(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t.msgsTitle} — {openConv?.name}
            </DialogTitle>
          </DialogHeader>
          {loadingMsgs ? (
            <div className="flex items-center justify-center p-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : msgs?.ok && msgs.messages.length > 0 ? (
            <ScrollArea className="h-[60vh] pe-4">
              <div className="space-y-3">
                {[...msgs.messages].reverse().map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.isFromPage ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                        m.isFromPage
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      <p className="mb-1 text-xs opacity-70">
                        {m.isFromPage ? t.you : m.fromName} · {formatDate(m.createdTime, ar)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{m.text || "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {msgs?.error?.message ?? t.msgsEmpty}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

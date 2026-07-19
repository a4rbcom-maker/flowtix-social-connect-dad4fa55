import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  KeyRound,
  RefreshCw,
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listBotAccounts, getJob } from "@/lib/fb-bot.functions";
import {
  enqueueTokenExtraction,
  syncPagesForAccount,
  syncPageConversations,
  listGraphPages,
  listSyncLogs,
  sendBulkGraph,
} from "@/lib/messenger-graph.functions";

const STAGE_LABELS: Record<string, string> = {
  session_validation: "التحقق من الجلسة",
  token_extract: "استخراج التوكن",
  pages_discovery: "اكتشاف الصفحات",
  conversations: "المحادثات",
  contacts_upsert: "جهات الاتصال",
  bulk_send: "الإرسال الجماعي",
};

function statusBadge(s: string) {
  if (s === "ok") return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">نجح</Badge>;
  if (s === "partial") return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">جزئي</Badge>;
  return <Badge className="bg-red-500/15 text-red-700 border-red-500/30">فشل</Badge>;
}

export function MessengerGraphPanel() {
  const qc = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [tokenJobId, setTokenJobId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendText, setSendText] = useState("");

  const listAccountsFn = useServerFn(listBotAccounts);
  const enqueueTokenFn = useServerFn(enqueueTokenExtraction);
  const syncPagesFn = useServerFn(syncPagesForAccount);
  const syncConvsFn = useServerFn(syncPageConversations);
  const listPagesFn = useServerFn(listGraphPages);
  const listLogsFn = useServerFn(listSyncLogs);
  const sendFn = useServerFn(sendBulkGraph);
  const getJobFn = useServerFn(getJob);

  const accountsQ = useQuery({
    queryKey: ["mgraph-accounts"],
    queryFn: () => listAccountsFn(),
  });

  const pagesQ = useQuery({
    queryKey: ["mgraph-pages", selectedAccountId],
    queryFn: () => listPagesFn({ data: selectedAccountId ? { accountId: selectedAccountId } : {} }),
    enabled: !!selectedAccountId,
  });

  const logsQ = useQuery({
    queryKey: ["mgraph-logs", selectedAccountId],
    queryFn: () =>
      listLogsFn({ data: selectedAccountId ? { accountId: selectedAccountId, limit: 30 } : { limit: 30 } }),
    refetchInterval: tokenJobId ? 3000 : 15000,
  });

  // Poll token extraction job
  useQuery({
    queryKey: ["mgraph-token-job", tokenJobId],
    queryFn: async () => {
      if (!tokenJobId) return null;
      const res = await getJobFn({ data: { jobId: tokenJobId } });
      const job = res?.job;
      if (job?.status === "completed") {
        toast.success("تم استخراج التوكن بنجاح. يمكنك الآن جلب الصفحات.");
        setTokenJobId(null);
        qc.invalidateQueries({ queryKey: ["mgraph-accounts"] });
      } else if (job?.status === "failed") {
        toast.error(`فشل استخراج التوكن: ${job.error_message ?? "خطأ غير معروف"}`);
        setTokenJobId(null);
      }
      return res;
    },
    enabled: !!tokenJobId,
    refetchInterval: 3000,
  });

  const enqueueMut = useMutation({
    mutationFn: (accountId: string) => enqueueTokenFn({ data: { accountId } }),
    onSuccess: (res) => {
      toast.info("بدأت مهمة استخراج التوكن من جلسة المتصفح…");
      setTokenJobId(res.jobId);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const syncPagesMut = useMutation({
    mutationFn: (accountId: string) => syncPagesFn({ data: { accountId } }),
    onSuccess: (res) => {
      toast.success(`تم اكتشاف ${res.count} صفحة`);
      qc.invalidateQueries({ queryKey: ["mgraph-pages", selectedAccountId] });
      qc.invalidateQueries({ queryKey: ["mgraph-logs", selectedAccountId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const syncConvsMut = useMutation({
    mutationFn: (pageDbId: string) => syncConvsFn({ data: { pageDbId } }),
    onSuccess: (res) =>
      toast.success(`تم جلب ${res.conversations} محادثة و ${res.contacts} جهة اتصال`),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["mgraph-logs", selectedAccountId] }),
  });

  const sendMut = useMutation({
    mutationFn: async (args: { pageDbId: string; text: string }) => {
      // Placeholder — the caller passes selected PSIDs from the main contacts list.
      // Here we require the user to open Send from the contacts table; keep as demo of the last-3 contacts.
      return sendFn({ data: { pageDbId: args.pageDbId, text: args.text, psids: [] as string[] } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const pages = pagesQ.data ?? [];
  const logs = logsQ.data ?? [];

  const selectedPage = pages.find((p: any) => p.id === selectedPageId);

  return (
    <Card className="p-5 space-y-5 border-primary/30">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-lg">مسار Graph API (الرسمي)</h3>
            <p className="text-xs text-muted-foreground">
              اكتشاف الصفحات والمحادثات مباشرة عبر Meta Graph API — أسرع وأكثر استقراراً من كشط الواجهة.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="bg-primary/5">مستقر</Badge>
      </div>

      {/* Account selector */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
          <SelectTrigger>
            <SelectValue placeholder="اختر حساب Facebook..." />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a: any) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label || a.username || a.id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!selectedAccountId || enqueueMut.isPending || !!tokenJobId}
          onClick={() => enqueueMut.mutate(selectedAccountId)}
        >
          {tokenJobId ? (
            <>
              <Loader2 className="h-4 w-4 me-2 animate-spin" /> جاري الاستخراج…
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4 me-2" /> استخراج التوكن
            </>
          )}
        </Button>
        <Button
          disabled={!selectedAccountId || syncPagesMut.isPending}
          onClick={() => syncPagesMut.mutate(selectedAccountId)}
        >
          {syncPagesMut.isPending ? (
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 me-2" />
          )}
          جلب الصفحات
        </Button>
      </div>

      {/* Pages */}
      {selectedAccountId && (
        <div className="space-y-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            <ChevronRight className="h-4 w-4" /> الصفحات المكتشفة ({pages.length})
          </div>
          {pages.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                لا توجد صفحات بعد. اضغط "استخراج التوكن" أولاً ثم "جلب الصفحات".
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {pages.map((p: any) => (
                <div
                  key={p.id}
                  className={`p-3 rounded-lg border flex items-center gap-3 cursor-pointer transition ${
                    selectedPageId === p.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedPageId(p.id)}
                >
                  {p.pictureUrl ? (
                    <img src={p.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.category ?? "—"} · {p.pageId}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      syncConvsMut.mutate(p.id);
                    }}
                    disabled={syncConvsMut.isPending}
                  >
                    {syncConvsMut.isPending && syncConvsMut.variables === p.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    <span className="ms-1">مزامنة</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk send trigger */}
      {selectedPage && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border">
          <div>
            <div className="text-sm font-semibold">الإرسال الجماعي عبر Send API</div>
            <div className="text-xs text-muted-foreground">
              الصفحة المحددة: <span className="font-mono">{selectedPage.name}</span> — يتم عبر PSIDs المستخرجة من المحادثات.
            </div>
          </div>
          <Button size="sm" onClick={() => setSendOpen(true)} variant="secondary">
            <Send className="h-4 w-4 me-2" /> تجهيز رسالة
          </Button>
        </div>
      )}

      {/* Logs */}
      <div className="space-y-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" /> سجل المراحل (آخر {logs.length})
        </div>
        {logs.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/40">لا يوجد سجل بعد.</div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-auto pr-1">
            {logs.map((l: any) => (
              <div
                key={l.id}
                className="p-2.5 rounded-md border bg-card flex items-start gap-3 text-sm"
              >
                <div className="shrink-0 mt-0.5">
                  {l.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : l.status === "partial" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{STAGE_LABELS[l.stage] ?? l.stage}</span>
                    {statusBadge(l.status)}
                    {l.failure_reason && (
                      <Badge variant="outline" className="text-[10px]">{l.failure_reason}</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ms-auto">
                      {new Date(l.created_at).toLocaleString("ar-EG")}
                      {l.duration_ms ? ` · ${l.duration_ms}ms` : ""}
                    </span>
                  </div>
                  {l.message && <div className="text-xs text-muted-foreground mt-0.5">{l.message}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send dialog (basic) */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرسال رسالة جماعية</DialogTitle>
          </DialogHeader>
          <Alert>
            <AlertTitle>ملاحظة مهمة</AlertTitle>
            <AlertDescription>
              للامتثال لسياسة Meta، الإرسال يتم بـ <b>MESSAGE_TAG: HUMAN_AGENT</b> وضمن نافذة 7 أيام من آخر تفاعل.
              اختر جهات الاتصال من الجدول الرئيسي بالأعلى ثم استخدم زر "إرسال جماعي" هناك — هذه النافذة للتجربة فقط.
            </AlertDescription>
          </Alert>
          <Textarea
            rows={4}
            placeholder="نص الرسالة..."
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSendOpen(false)}>إغلاق</Button>
            <Button
              disabled={!selectedPage || !sendText.trim() || sendMut.isPending}
              onClick={() => selectedPage && sendMut.mutate({ pageDbId: selectedPage.id, text: sendText })}
            >
              {sendMut.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              اختبار
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

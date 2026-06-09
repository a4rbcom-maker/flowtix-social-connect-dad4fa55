import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil, Zap, MessageSquareText, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  listKeywordRules,
  createKeywordRule,
  updateKeywordRule,
  toggleKeywordRule,
  deleteKeywordRule,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  type KeywordRule,
  type QuickReply,
} from "@/lib/wa-automation.functions";

export const Route = createFileRoute("/dashboard/whatsapp/automation")({
  ssr: false,
  component: AutomationPage,
});

function AutomationPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/dashboard/whatsapp/inbox"
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="back"
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isAr ? "البوت (ردود الكلمات)" : "Bot (Keyword Replies)"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "البوت يرد تلقائياً على كلمات مفتاحية محددة. للرد الذكي عبر AI استخدم وكيل الذكاء الاصطناعي."
              : "The bot auto-replies to specific keywords. For AI-powered replies use the AI Agent."}
          </p>
        </div>
      </div>

      <Tabs defaultValue="rules" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="rules" className="gap-2">
            <Zap className="h-4 w-4" />
            {isAr ? "الكلمات المفتاحية" : "Keyword Rules"}
          </TabsTrigger>
          <TabsTrigger value="snippets" className="gap-2">
            <MessageSquareText className="h-4 w-4" />
            {isAr ? "الردود الجاهزة" : "Quick Replies"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <KeywordRulesPanel isAr={isAr} />
        </TabsContent>
        <TabsContent value="snippets" className="mt-4">
          <QuickRepliesPanel isAr={isAr} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Keyword Rules ─────────────────────────────────────────────────────────
function KeywordRulesPanel({ isAr }: { isAr: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listKeywordRules);
  const createFn = useServerFn(createKeywordRule);
  const updateFn = useServerFn(updateKeywordRule);
  const toggleFn = useServerFn(toggleKeywordRule);
  const deleteFn = useServerFn(deleteKeywordRule);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-keyword-rules"],
    queryFn: () => listFn(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wa-keyword-rules"] });

  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleFn({ data: vars }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(isAr ? "تم الحذف" : "Deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<KeywordRule | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "لما تتطابق كلمة مفتاحية، البوت يبعت الرد فوراً ويوقف الـ AI لهذه الرسالة."
              : "When a keyword matches, the bot sends the reply instantly and skips AI for that message."}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {isAr ? "قاعدة جديدة" : "New rule"}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground">
            <Zap className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">
              {isAr ? "لا توجد قواعد بعد. اضغط (قاعدة جديدة)." : "No rules yet. Click New rule."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(data ?? []).map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{rule.label}</p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {rule.match_mode === "exact"
                        ? isAr ? "تطابق تام" : "Exact"
                        : isAr ? "احتواء" : "Contains"}
                    </span>
                    {rule.hit_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {isAr ? `استُخدمت ${rule.hit_count} مرة` : `${rule.hit_count} hits`}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rule.keywords.map((k, i) => (
                      <span
                        key={i}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                    ↳ {rule.reply_text}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(checked) =>
                      toggleMut.mutate({ id: rule.id, enabled: checked })
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(rule);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(isAr ? "حذف هذه القاعدة؟" : "Delete this rule?")) {
                        deleteMut.mutate(rule.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <KeywordRuleDialog
        open={open}
        onOpenChange={setOpen}
        rule={editing}
        isAr={isAr}
        onSave={async (form) => {
          try {
            if (editing) {
              await updateFn({ data: { id: editing.id, ...form } });
              toast.success(isAr ? "تم التحديث" : "Updated");
            } else {
              await createFn({ data: form });
              toast.success(isAr ? "تمت الإضافة" : "Created");
            }
            invalidate();
            setOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error");
          }
        }}
      />
    </div>
  );
}

function KeywordRuleDialog({
  open,
  onOpenChange,
  rule,
  isAr,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: KeywordRule | null;
  isAr: boolean;
  onSave: (form: {
    label: string;
    keywords: string[];
    match_mode: "exact" | "contains";
    reply_text: string;
    enabled: boolean;
    priority: number;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [keywords, setKeywords] = useState("");
  const [matchMode, setMatchMode] = useState<"exact" | "contains">("contains");
  const [replyText, setReplyText] = useState("");
  const [priority, setPriority] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setLabel(rule?.label ?? "");
      setKeywords(rule?.keywords?.join(", ") ?? "");
      setMatchMode(rule?.match_mode ?? "contains");
      setReplyText(rule?.reply_text ?? "");
      setPriority(rule?.priority ?? 0);
      setEnabled(rule?.enabled ?? true);
    }
  }, [open, rule]);

  const submit = async () => {
    const kws = keywords
      .split(/[,،\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!label.trim() || !replyText.trim() || kws.length === 0) {
      toast.error(isAr ? "املأ كل الحقول" : "Fill all fields");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        label: label.trim(),
        keywords: kws,
        match_mode: matchMode,
        reply_text: replyText.trim(),
        enabled,
        priority,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {rule ? (isAr ? "تعديل القاعدة" : "Edit rule") : isAr ? "قاعدة جديدة" : "New rule"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{isAr ? "اسم القاعدة" : "Label"}</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={isAr ? "مثال: الترحيب" : "e.g. Greeting"}
            />
          </div>
          <div>
            <Label>{isAr ? "الكلمات / العبارات (افصل بفاصلة)" : "Keywords (comma separated)"}</Label>
            <Textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={2}
              placeholder={isAr ? "سلام, hello, مرحبا" : "hello, hi, hey"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{isAr ? "نوع المطابقة" : "Match mode"}</Label>
              <Select value={matchMode} onValueChange={(v) => setMatchMode(v as "exact" | "contains")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{isAr ? "احتواء (الأكثر مرونة)" : "Contains"}</SelectItem>
                  <SelectItem value="exact">{isAr ? "تطابق تام" : "Exact"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{isAr ? "الأولوية" : "Priority"}</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div>
            <Label>{isAr ? "نص الرد" : "Reply text"}</Label>
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              placeholder={isAr ? "اكتب الرد..." : "Reply..."}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm">{isAr ? "مفعّلة" : "Enabled"}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isAr ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Quick Replies ─────────────────────────────────────────────────────────
function QuickRepliesPanel({ isAr }: { isAr: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listQuickReplies);
  const createFn = useServerFn(createQuickReply);
  const updateFn = useServerFn(updateQuickReply);
  const deleteFn = useServerFn(deleteQuickReply);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-quick-replies-mgmt"],
    queryFn: () => listFn(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wa-quick-replies-mgmt"] });
    qc.invalidateQueries({ queryKey: ["wa-quick-replies"] });
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(isAr ? "تم الحذف" : "Deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "ردود تظهر بجانب صندوق الدردشة لاختيارها بسرعة وإرسالها."
            : "Reusable snippets that appear next to the chat composer."}
        </p>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {isAr ? "رد جديد" : "New snippet"}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground">
            <MessageSquareText className="mx-auto mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">
              {isAr ? "لا توجد ردود جاهزة بعد." : "No quick replies yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {(data ?? []).map((q) => (
              <li key={q.id} className="flex items-start gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-primary">/{q.shortcut}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{q.body}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(q);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(isAr ? "حذف هذا الرد؟" : "Delete this snippet?")) {
                        deleteMut.mutate(q.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <QuickReplyDialog
        open={open}
        onOpenChange={setOpen}
        snippet={editing}
        isAr={isAr}
        onSave={async (form) => {
          try {
            if (editing) {
              await updateFn({ data: { id: editing.id, ...form } });
              toast.success(isAr ? "تم التحديث" : "Updated");
            } else {
              await createFn({ data: form });
              toast.success(isAr ? "تمت الإضافة" : "Created");
            }
            invalidate();
            setOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error");
          }
        }}
      />
    </div>
  );
}

function QuickReplyDialog({
  open,
  onOpenChange,
  snippet,
  isAr,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  snippet: QuickReply | null;
  isAr: boolean;
  onSave: (form: { shortcut: string; body: string; sort_order: number }) => Promise<void>;
}) {
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [order, setOrder] = useState(0);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) {
      setShortcut(snippet?.shortcut ?? "");
      setBody(snippet?.body ?? "");
      setOrder(snippet?.sort_order ?? 0);
    }
  }, [open, snippet]);

  const submit = async () => {
    if (!shortcut.trim() || !body.trim()) {
      toast.error(isAr ? "املأ كل الحقول" : "Fill all fields");
      return;
    }
    setSaving(true);
    try {
      await onSave({ shortcut: shortcut.trim(), body: body.trim(), sort_order: order });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {snippet ? (isAr ? "تعديل الرد" : "Edit snippet") : isAr ? "رد جديد" : "New snippet"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{isAr ? "اختصار" : "Shortcut"}</Label>
            <Input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder={isAr ? "مثال: ترحيب" : "e.g. greet"}
            />
          </div>
          <div>
            <Label>{isAr ? "النص" : "Body"}</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={isAr ? "محتوى الرد..." : "Snippet body..."}
            />
          </div>
          <div>
            <Label>{isAr ? "الترتيب" : "Sort order"}</Label>
            <Input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {isAr ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isAr ? "حفظ" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings, MessageSquare, Clock, Zap, Plus, Edit2, Trash2, Save, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useWaAutoReplySettings, useUpdateWaAutoReply, useWaBusinessHours, useUpdateWaBusinessHours, useWaQuickReplies, useCreateWaQuickReply, useUpdateWaQuickReply, useDeleteWaQuickReply } from "@/hooks/useWaSettings";
import type { WaAutoReplySettings, WaBusinessHourDay, OutsideHoursAction, WaQuickReply, WaQuickReplyInput, QuickReplyCategory } from "@/types/wa-settings.types";
import { DEFAULT_BUSINESS_HOURS, DAY_NAMES, TIMEZONE_OPTIONS, OUTSIDE_HOURS_OPTIONS, QUICK_REPLY_CATEGORIES } from "@/types/wa-settings.types";

type Tab = "auto_reply" | "business_hours" | "quick_replies";

export function WaSettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("auto_reply");
  const tabs: { key: Tab; icon: typeof Settings; label: string }[] = [
    { key: "auto_reply", icon: MessageSquare, label: t("waSettings.autoReply") },
    { key: "business_hours", icon: Clock, label: t("waSettings.businessHours") },
    { key: "quick_replies", icon: Zap, label: t("waSettings.quickReplies") },
  ];

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader title={t("waSettings.title")} description={t("waSettings.description")} icon={Settings} />

      <div className="flex gap-1 rounded-xl bg-[var(--color-surface-2)] p-1 w-fit">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button key={tb.key} onClick={() => setActiveTab(tb.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${activeTab === tb.key ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"}`}>
              <Icon size={16} />{tb.label}
            </button>
          );
        })}
      </div>

      {activeTab === "auto_reply" && <AutoReplyTab />}
      {activeTab === "business_hours" && <BusinessHoursTab />}
      {activeTab === "quick_replies" && <QuickRepliesTab />}
    </div>
  );
}

function AutoReplyTab() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useWaAutoReplySettings();
  const updateMutation = useUpdateWaAutoReply();
  const [form, setForm] = useState<WaAutoReplySettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  if (settings && !form) setForm(settings);
  if (isLoading || !form) return <LoadingState />;

  const update = (patch: Partial<WaAutoReplySettings>) => { setForm({ ...form, ...patch }); setHasChanges(true); };
  const handleSave = () => updateMutation.mutate(form, {
    onSuccess: () => { toast({ type: "success", title: t("waSettings.saved") }); setHasChanges(false); },
    onError: (e: any) => toast({ type: "error", title: e.message === "no_wa_session_config" ? t("waSettings.noWaConfig") : t("common.error") }),
  });

  return (
    <div className="space-y-4">
      <Card hover="lift">
        <CardContent className="flex items-center justify-between pt-6">
          <div>
            <h3 className="font-medium text-[var(--color-fg)]">{t("waSettings.enableAutoReply")}</h3>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("waSettings.enableAutoReplyDesc")}</p>
          </div>
          <button onClick={() => update({ is_enabled: !form.is_enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.is_enabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]"}`}>
            <span className={`absolute top-0.5 start-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.is_enabled ? "translate-x-5 rtl:-translate-x-5" : ""}`} />
          </button>
        </CardContent>
      </Card>
      {[["welcomeMessage","welcomeMessagePlaceholder","welcomeMessageHint"],["awayMessage","awayMessagePlaceholder","awayMessageHint"],["offlineMessage","offlineMessagePlaceholder","offlineMessageHint"]].map(([key,ph,hint]) => (
        <Card hover="lift" key={key}>
          <CardHeader><CardTitle className="text-base">{t(`waSettings.${key}`)}</CardTitle></CardHeader>
          <CardContent>
            <textarea value={(form as any)[`${key === "welcomeMessage" ? "welcome" : key === "awayMessage" ? "away" : "offline"}_message`]}
              onChange={(e) => {const k = key === "welcomeMessage" ? "welcome_message" : key === "awayMessage" ? "away_message" : "offline_message"; update({ [k]: e.target.value } as any);}}
              placeholder={t(`waSettings.${ph}`)}
              className="w-full min-h-[80px] p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25" />
            <p className="text-xs text-[var(--color-fg-muted)] mt-1">{t(`waSettings.${hint}`)}</p>
          </CardContent>
        </Card>
      ))}
      <Card hover="lift">
        <CardContent className="flex items-center justify-between pt-6">
          <div><h3 className="font-medium text-[var(--color-fg)]">{t("waSettings.useBusinessHours")}</h3>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("waSettings.useBusinessHoursDesc")}</p></div>
          <button onClick={() => update({ use_business_hours: !form.use_business_hours })}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.use_business_hours ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]"}`}>
            <span className={`absolute top-0.5 start-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.use_business_hours ? "translate-x-5 rtl:-translate-x-5" : ""}`} />
          </button>
        </CardContent>
      </Card>
      {hasChanges && (
        <div className="flex justify-end"><Button variant="primary" onClick={handleSave} loading={updateMutation.isPending} className="gap-2 shadow-lg"><Save size={16} />{t("common.save")}</Button></div>
      )}
    </div>
  );
}

function BusinessHoursTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const { data: hours, isLoading } = useWaBusinessHours();
  const updateMutation = useUpdateWaBusinessHours();
  const [schedule, setSchedule] = useState<WaBusinessHourDay[]>(DEFAULT_BUSINESS_HOURS);
  const [isEnabled, setIsEnabled] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [outsideAction, setOutsideAction] = useState<OutsideHoursAction>("auto_reply");
  const [outsideMessage, setOutsideMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (hours && !loaded) { setSchedule(hours.schedule?.length ? hours.schedule : DEFAULT_BUSINESS_HOURS); setIsEnabled(hours.is_enabled); setTimezone(hours.timezone || "UTC"); setOutsideAction(hours.outside_hours_action || "auto_reply"); setOutsideMessage(hours.outside_hours_message || ""); setLoaded(true); }
  if (isLoading) return <LoadingState />;

  const updateDay = (dayIdx: number, patch: Partial<WaBusinessHourDay>) => setSchedule(schedule.map((d) => (d.day === dayIdx ? { ...d, ...patch } : d)));
  const handleSave = () => updateMutation.mutate({ is_enabled: isEnabled, timezone, schedule, outside_hours_action: outsideAction, outside_hours_message: outsideMessage || null }, {
    onSuccess: () => toast({ type: "success", title: t("waSettings.saved") }),
    onError: (e: any) => toast({ type: "error", title: e.message === "invalid_action" ? t("waSettings.invalidAction") : t("common.error") }),
  });

  return (
    <div className="space-y-4">
      <Card hover="lift"><CardContent className="flex items-center justify-between pt-6"><div><h3 className="font-medium text-[var(--color-fg)]">{t("waSettings.enableBusinessHours")}</h3><p className="text-sm text-[var(--color-fg-muted)]">{t("waSettings.enableBusinessHoursDesc")}</p></div><button onClick={() => setIsEnabled(!isEnabled)} className={`relative w-11 h-6 rounded-full transition-colors ${isEnabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]"}`}><span className={`absolute top-0.5 start-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${isEnabled ? "translate-x-5 rtl:-translate-x-5" : ""}`} /></button></CardContent></Card>
      <Card hover="lift"><CardContent className="space-y-2 pt-6"><Label>{t("waSettings.timezone")}</Label><Select value={timezone} onValueChange={setTimezone} options={TIMEZONE_OPTIONS.map((tz) => ({ value: tz, label: tz }))} /></CardContent></Card>
      <Card hover="lift"><CardHeader><CardTitle className="text-base">{t("waSettings.weeklySchedule")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {schedule.map((day) => (
            <div key={day.day} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)]">
              <button onClick={() => updateDay(day.day, { enabled: !day.enabled })} className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${day.enabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]"}`}><span className={`absolute top-0.5 start-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${day.enabled ? "translate-x-5 rtl:-translate-x-5" : ""}`} /></button>
              <span className="w-24 text-sm font-medium text-[var(--color-fg)]">{DAY_NAMES[day.day][locale]}</span>
              {day.enabled ? <div className="flex items-center gap-2"><input type="time" value={day.from} onChange={(e) => updateDay(day.day, { from: e.target.value })} className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-sm text-[var(--color-fg)]" /><span className="text-[var(--color-fg-muted)]">—</span><input type="time" value={day.to} onChange={(e) => updateDay(day.day, { to: e.target.value })} className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-sm text-[var(--color-fg)]" /></div> : <Badge variant="default">{t("waSettings.closed")}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card hover="lift"><CardHeader><CardTitle className="text-base">{t("waSettings.outsideHoursAction")}</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={outsideAction} onValueChange={(val) => setOutsideAction(val as OutsideHoursAction)} options={OUTSIDE_HOURS_OPTIONS.map((o) => ({ value: o.value, label: o.label[locale] }))} />{outsideAction === "auto_reply" && <div><Label>{t("waSettings.outsideHoursMessage")}</Label><textarea value={outsideMessage} onChange={(e) => setOutsideMessage(e.target.value)} placeholder={t("waSettings.outsideHoursMessagePlaceholder")} className="w-full min-h-[80px] p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25" /></div>}</CardContent></Card>
      <div className="flex justify-end"><Button variant="primary" onClick={handleSave} loading={updateMutation.isPending} className="gap-2"><Save size={16} />{t("common.save")}</Button></div>
    </div>
  );
}

function QuickRepliesTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const [category, setCategory] = useState<string>("");
  const [editReply, setEditReply] = useState<WaQuickReply | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { data: replies, isLoading } = useWaQuickReplies(category ? (category as QuickReplyCategory) : undefined);
  return (
    <div className="space-y-4">
      <Card hover="lift"><CardContent className="flex items-center gap-3 pt-6"><div className="w-48"><Select value={category} onValueChange={setCategory} options={[{ value: "", label: t("waSettings.allCategories") }, ...QUICK_REPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label[locale] }))]} /></div><Button variant="primary" className="gap-2 ms-auto" onClick={() => setIsCreateOpen(true)}><Plus size={16} />{t("waSettings.addReply")}</Button></CardContent></Card>
      <Card hover="lift"><CardContent className="p-0">{isLoading ? <LoadingState /> : !replies?.length ? <div className="p-6"><EmptyState title={t("waSettings.noReplies")} icon={Zap} /></div> : <Table><TableHeader><TableRow><TableHead>{t("waSettings.shortcut")}</TableHead><TableHead>{t("waSettings.titleCol")}</TableHead><TableHead>{t("waSettings.category")}</TableHead><TableHead>{t("waSettings.body")}</TableHead><TableHead className="text-end">{t("waSettings.actions", "Actions")}</TableHead></TableRow></TableHeader><TableBody>{replies.map((r) => (<TableRow key={r.id}><TableCell><code className="text-sm bg-[var(--color-surface-2)] px-2 py-0.5 rounded text-[var(--color-fg)]">/{r.shortcut}</code></TableCell><TableCell className="text-sm font-medium text-[var(--color-fg)]">{r.title}</TableCell><TableCell><Badge variant="outline">{QUICK_REPLY_CATEGORIES.find((c) => c.value === r.category)?.label[locale]}</Badge></TableCell><TableCell className="text-sm text-[var(--color-fg-muted)] max-w-[300px] truncate">{r.body}</TableCell><TableCell className="text-end"><Button variant="ghost" size="sm" onClick={() => setEditReply(r)}><Edit2 size={14} /></Button><DeleteQuickReplyBtn id={r.id} /></TableCell></TableRow>))}</TableBody></Table>}</CardContent></Card>
      {editReply && <QuickReplyDialog reply={editReply} onClose={() => setEditReply(null)} />}
      {isCreateOpen && <QuickReplyDialog isOpen={true} onClose={() => setIsCreateOpen(false)} />}
    </div>
  );
}

function DeleteQuickReplyBtn({ id }: { id: string }) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteWaQuickReply();
  return <Button variant="ghost" size="sm" onClick={() => { if (confirm(t("waSettings.confirmDelete"))) deleteMutation.mutate(id); }}><Trash2 size={14} className="text-red-500" /></Button>;
}

function QuickReplyDialog({ reply, isOpen = true, onClose }: { reply?: WaQuickReply; isOpen?: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar" : "en";
  const isEdit = !!reply;
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? "");
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [category, setCategory] = useState<QuickReplyCategory>(reply?.category ?? "general");
  const createMutation = useCreateWaQuickReply();
  const updateMutation = useUpdateWaQuickReply();
  const deleteMutation = useDeleteWaQuickReply();
  const handleSave = () => {
    if (!shortcut.trim() || !title.trim() || !body.trim()) { toast({ type: "error", title: t("waSettings.fillFields") }); return; }
    const input: WaQuickReplyInput = { shortcut: shortcut.trim().replace(/^\//, ""), title: title.trim(), body: body.trim(), category };
    if (isEdit && reply) { updateMutation.mutate({ id: reply.id, input }, { onSuccess: () => { toast({ type: "success", title: t("waSettings.saved") }); onClose(); }, onError: () => toast({ type: "error", title: t("common.error") }) }); }
    else { createMutation.mutate(input, { onSuccess: () => { toast({ type: "success", title: t("waSettings.created") }); onClose(); }, onError: () => toast({ type: "error", title: t("common.error") }) }); }
  };
  const handleDelete = () => { if (!reply) return; if (!confirm(t("waSettings.confirmDelete"))) return; deleteMutation.mutate(reply.id, { onSuccess: () => { toast({ type: "success", title: t("waSettings.deleted") }); onClose(); }, onError: () => toast({ type: "error", title: t("common.error") }) }); };
  return (
    <Dialog open={isOpen} onClose={onClose}>
      <DialogHeader><DialogTitle>{isEdit ? t("waSettings.editReply") : t("waSettings.createReply")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
      <DialogBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3"><div><Label>{t("waSettings.shortcut")}</Label><div className="flex items-center gap-1"><span className="text-[var(--color-fg-muted)]">/</span><Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="hello" /></div></div><div><Label>{t("waSettings.category")}</Label><Select value={category} onValueChange={(val) => setCategory(val as QuickReplyCategory)} options={QUICK_REPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label[locale] }))} /></div></div>
        <div><Label>{t("waSettings.titleCol")}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("waSettings.titlePlaceholder")} /></div>
        <div><Label>{t("waSettings.body")}</Label><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("waSettings.bodyPlaceholder")} className="w-full min-h-[100px] p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25" /></div>
      </DialogBody>
      <DialogFooter className="flex justify-between">{isEdit ? <Button variant="danger" onClick={handleDelete} loading={deleteMutation.isPending} className="gap-2"><Trash2 size={16} />{t("common.delete","Delete")}</Button> : <span />}<div className="flex gap-2"><Button variant="ghost" onClick={onClose} className="gap-2"><X size={16} />{t("common.cancel")}</Button><Button variant="primary" onClick={handleSave} loading={createMutation.isPending || updateMutation.isPending} className="gap-2"><Save size={16} />{t("common.save")}</Button></div></DialogFooter>
    </Dialog>
  );
}

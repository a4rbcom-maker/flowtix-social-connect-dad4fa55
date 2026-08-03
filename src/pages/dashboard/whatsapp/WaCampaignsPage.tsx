import { useState } from "react";
import { Plus, Play, Pause, RotateCcw, StopCircle, Loader2, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { useWaCampaigns, useWaCampaignMutations } from "@/hooks/useWaCampaigns";
import { useWaSessions } from "@/hooks/useWaSessions";
import { useWaTemplates } from "@/hooks/useWaCampaigns";
import type { WaCampaignStatus } from "@/types/wa-campaigns.types";

const statusBadge: Record<string, { variant: "success" | "primary" | "default" | "warning" | "error"; label: string }> = {
  draft: { variant: "default", label: "مسودة" }, scheduled: { variant: "warning", label: "مجدولة" },
  running: { variant: "primary", label: "جاري" }, paused: { variant: "warning", label: "متوقف" },
  completed: { variant: "success", label: "مكتمل" }, failed: { variant: "error", label: "فشل" },
  canceled: { variant: "default", label: "ملغي" },
};

const messageTypes = ["text","image","video","document"];

export function WaCampaignsPage() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id || ""; const uid = authSession?.user?.id || "";
  const [tab, setTab] = useState<string>("draft");
  const { data: campaigns, isLoading } = useWaCampaigns(tab as WaCampaignStatus);
  const { control, create } = useWaCampaignMutations();

  // Sessions for dropdown
  const { data: sessions } = useWaSessions();
  // Templates
  const { data: templates } = useWaTemplates();

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState(1);
  const [wizName, setWizName] = useState("");
  const [wizSession, setWizSession] = useState("");
  const [wizType, setWizType] = useState("text");
  const [wizBody, setWizBody] = useState("");
  const [wizTemplate, setWizTemplate] = useState("");
  const [wizUseTemplate, setWizUseTemplate] = useState(false);
  const [wizDelayMin, setWizDelayMin] = useState("30");
  const [wizDelayMax, setWizDelayMax] = useState("120");
  const [wizRate, setWizRate] = useState("50");

  const handleCreate = () => {
    if (!wizName.trim() || !wizSession) { toast({type:"error",title:"الرجاء إدخال اسم الحملة واختيار الرقم"}); return; }
    create.mutate({
      workspaceId: ws, userId: uid, sessionId: wizSession, name: wizName, type: wizType,
      content: wizUseTemplate ? { template_id: wizTemplate } : { body: wizBody },
      config: { delay_min: +wizDelayMin, delay_max: +wizDelayMax, rate_per_hour: +wizRate, retry_max: 3 },
      audienceFilter: {}, // All contacts
    }, {
      onSuccess: (result: any) => {
        setShowWizard(false); resetWizard();
        control.mutate({ id: result.id, action: "start" });
        toast({ type: "success", title: "تم إنشاء الحملة وبدء الإرسال" });
      },
      onError: (e: any) => toast({ type: "error", title: e.message }),
    });
  };

  const resetWizard = () => { setStep(1); setWizName(""); setWizSession(""); setWizType("text"); setWizBody(""); setWizTemplate(""); setWizUseTemplate(false); };

  return (
    <div className="space-y-4">
      <PageHeader title="الحملات" description="إدارة حملات واتساب" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {["draft","scheduled","running","paused","completed"].map(k => (
            <button key={k} onClick={() => setTab(k)} className={cn("px-3 py-1.5 text-sm rounded-lg transition-colors", tab === k ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>{statusBadge[k]?.label ?? k}</button>
          ))}
        </div>
        <Button onClick={() => { setShowWizard(true); setStep(1); }}><Plus className="size-4" /> حملة جديدة</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]"><tr><th className="p-3 text-start">الاسم</th><th className="p-3 text-start">الحالة</th><th className="p-3 text-start hidden md:table-cell">التقدم</th><th className="p-3 text-start hidden md:table-cell">النوع</th><th className="p-3 w-32"></th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="p-4 text-center"><Loader2 className="size-5 animate-spin mx-auto" /></td></tr> :
             campaigns?.map(c => {
              const s = (c.stats || {}) as any;
              const total = s.total || 0; const sent = s.sent || 0; const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
              const badge = statusBadge[c.status] ?? { variant: "default" as const, label: c.status };
              return (
                <tr key={c.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                  <td className="p-3 hidden md:table-cell"><div className="w-32 bg-[var(--color-surface-2)] rounded-full h-2"><div className="bg-[var(--color-primary)] h-2 rounded-full transition-all" style={{ width: `${pct}%` }} /></div><span className="text-[10px] text-[var(--color-fg-muted)]">{sent}/{total}</span></td>
                  <td className="p-3 hidden md:table-cell text-[var(--color-fg-muted)]">{c.type}</td>
                  <td className="p-3 flex gap-1">
                    {c.status === "draft" && <Button size="icon" variant="ghost" className="size-7" onClick={() => control.mutate({ id: c.id, action: "start" })}><Play className="size-3" /></Button>}
                    {c.status === "running" && <Button size="icon" variant="ghost" className="size-7" onClick={() => control.mutate({ id: c.id, action: "pause" })}><Pause className="size-3" /></Button>}
                    {c.status === "paused" && <Button size="icon" variant="ghost" className="size-7" onClick={() => control.mutate({ id: c.id, action: "resume" })}><RotateCcw className="size-3" /></Button>}
                    {(c.status === "running" || c.status === "paused") && <Button size="icon" variant="ghost" className="size-7" onClick={() => control.mutate({ id: c.id, action: "stop" })}><StopCircle className="size-3" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>

      {/* Create Campaign Wizard */}
      <Dialog open={showWizard} onClose={() => { setShowWizard(false); resetWizard(); }}>
        <DialogHeader><DialogTitle>حملة جديدة — الخطوة {step} من 4</DialogTitle><DialogClose onClose={() => { setShowWizard(false); resetWizard(); }} /></DialogHeader>
        <DialogBody className="min-h-[200px]">
          {step === 1 && (
            <div className="space-y-4">
              <div><label className="text-xs font-semibold text-[var(--color-fg-muted)]">اسم الحملة</label><input value={wizName} onChange={e => setWizName(e.target.value)} placeholder="مثال: عرض الخصم" className="w-full border rounded-lg px-3 py-2 text-sm mt-1" /></div>
              <div><label className="text-xs font-semibold text-[var(--color-fg-muted)]">رقم واتساب</label>
                <select value={wizSession} onChange={e => setWizSession(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                  <option value="">اختر الرقم...</option>
                  {sessions?.filter((s: any) => s.status === "connected").map((s: any) => <option key={s.id} value={s.id}>{s.name || s.phone_number}</option>)}
                </select>
              </div>
              <div><label className="text-xs font-semibold text-[var(--color-fg-muted)]">نوع الرسالة</label>
                <select value={wizType} onChange={e => setWizType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                  {messageTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <Button variant={wizUseTemplate ? "outline" : "primary"} size="sm" onClick={() => setWizUseTemplate(false)}>يدوي</Button>
                <Button variant={wizUseTemplate ? "primary" : "outline"} size="sm" onClick={() => setWizUseTemplate(true)}>قالب</Button>
              </div>
              {wizUseTemplate ? (
                <div><label className="text-xs font-semibold text-[var(--color-fg-muted)]">اختر قالب</label>
                  <select value={wizTemplate} onChange={e => setWizTemplate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                    <option value="">اختر...</option>
                    {templates?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ) : (
                <div><label className="text-xs font-semibold text-[var(--color-fg-muted)]">نص الرسالة</label><textarea value={wizBody} onChange={e => setWizBody(e.target.value)} placeholder="اكتب رسالتك..." className="w-full border rounded-lg px-3 py-2 text-sm mt-1 min-h-[120px]" /></div>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">الجمهور المستهدف</p>
              <div className="p-4 rounded-xl bg-[var(--color-surface-2)] text-center">
                <p className="text-2xl font-bold">جميع جهات الاتصال</p>
                <p className="text-xs text-[var(--color-fg-muted)] mt-1">تصفية الجمهور ستتوفر في تحديث قادم</p>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="text-[11px] font-semibold text-[var(--color-fg-muted)]">أقل تأخير (ث)</label><input type="number" value={wizDelayMin} onChange={e => setWizDelayMin(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" min={30} /></div>
                <div><label className="text-[11px] font-semibold text-[var(--color-fg-muted)]">أقصى تأخير (ث)</label><input type="number" value={wizDelayMax} onChange={e => setWizDelayMax(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" min={30} /></div>
              </div>
              <div><label className="text-[11px] font-semibold text-[var(--color-fg-muted)]">الحد الأقصى بالساعة</label><input type="number" value={wizRate} onChange={e => setWizRate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm mt-1" max={50} /></div>
              <div className="p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30 text-xs text-[var(--color-warning)]">⚠️ إرسال أكثر من 50 رسالة/ساعة قد يعرّض الرقم للحظر. استخدم رقماً مخصصاً للحملات.</div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)}><ChevronLeft className="size-4 rtl:rotate-180" /> السابق</Button>}
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && (!wizName || !wizSession)}>التالي <ChevronRight className="size-4 rtl:rotate-180" /></Button>
          ) : (
            <Button onClick={handleCreate} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              إنشاء وبدء الإرسال
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  );
}

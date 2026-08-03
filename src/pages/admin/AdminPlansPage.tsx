import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Plus, Pencil, Copy, Check, Users, Loader2, Trash2, Eye, EyeOff } from "lucide-react";
import { useAdminPlans, useCreatePlan, useUpdatePlan, useTogglePlan, useDeletePlan } from "@/hooks/useAdmin";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/utils";
import { DEFAULT_PLAN_LIMITS } from "@/types/admin.types";
import type { AdminPlanListItem, AdminPlanInput } from "@/types/admin.types";

export function AdminPlansPage() {
  const { t } = useTranslation();
  const { data: plans, isLoading } = useAdminPlans();
  const togglePlan = useTogglePlan();
  const deletePlan = useDeletePlan();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminPlanListItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminPlanListItem | null>(null);

  function handleAction(planId: string, action: string, plan: AdminPlanListItem) {
    switch (action) {
      case "edit": setEditingPlan(plan); setDialogOpen(true); break;
      case "toggle":
        togglePlan.mutate({ planId, isActive: !plan.is_active }, {
          onSuccess: () => toast({ type: "success", title: t("admin.plans.toggledOk") }),
          onError: (e) => toast({ type: "error", title: e.message.includes("active_subscriptions") ? t("admin.plans.hasActiveSubs") : e.message }),
        }); break;
      case "duplicate":
        setEditingPlan({ ...plan, id: "", name: `${plan.name} (Copy)`, key: `${plan.key}-copy`, active_subscriptions: 0, total_subscriptions: 0 } as AdminPlanListItem);
        setDialogOpen(true); break;
      case "delete": setConfirmDelete(plan); break;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.plans.title")} icon={CreditCard} action={<Button onClick={() => { setEditingPlan(null); setDialogOpen(true); }}><Plus className="size-4" />{t("admin.plans.create")}</Button>} />

      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div> :
       !plans || plans.length === 0 ? <div className="py-12 text-center text-[var(--color-fg-muted)]">{t("admin.plans.empty")}</div> : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map(plan => <PlanCard key={plan.id} plan={plan} onAction={(a) => handleAction(plan.id, a, plan)} />)}
        </div>
      )}

      <PlanFormDialog open={dialogOpen} plan={editingPlan} onClose={() => { setDialogOpen(false); setEditingPlan(null); }} />
      {confirmDelete && (
        <Dialog open onClose={() => setConfirmDelete(null)}>
          <DialogHeader><DialogTitle>{t("admin.plans.confirmDelete")}</DialogTitle><DialogClose onClose={() => setConfirmDelete(null)} /></DialogHeader>
          <DialogBody><div className="flex flex-col items-center gap-4 py-4 text-center"><div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]"><Trash2 className="size-8 text-[var(--color-error)]" /></div><p className="text-sm text-[var(--color-fg-muted)]">{t("admin.plans.confirmDeleteDesc", "This will permanently delete \"{{name}}\"", { name: confirmDelete.name })}</p></div></DialogBody>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirmDelete(null)}>{t("common.no")}</Button><Button variant="danger" onClick={() => { deletePlan.mutate(confirmDelete.id, { onSuccess: () => { toast({ type: "success", title: t("admin.settings.deleted") }); setConfirmDelete(null); }, onError: (e) => toast({ type: "error", title: e.message }) }); }}>{t("common.yes")}</Button></DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

function PlanCard({ plan, onAction }: { plan: AdminPlanListItem; onAction: (k: string) => void }) {
  const { t } = useTranslation();
  return (
    <Card hover="lift">
      <CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-lg">{plan.name}</CardTitle><p className="text-xs text-[var(--color-fg-muted)]">{plan.key}</p></div><Badge variant={plan.is_active ? "success" : "default"}>{plan.is_active ? t("admin.plans.active") : t("admin.plans.inactive")}</Badge></div></CardHeader>
      <CardContent>
        <div className="mb-4 flex items-baseline gap-1"><span className="text-3xl font-extrabold">{formatCurrency(plan.price_cents, plan.currency)}</span><span className="text-sm text-[var(--color-fg-muted)]">/ {plan.interval === "yearly" ? t("admin.plans.year") : t("admin.plans.month")}</span></div>
        {plan.description && <p className="mb-3 text-sm text-[var(--color-fg-muted)]">{plan.description}</p>}
        {plan.trial_days > 0 && <div className="mb-3 flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]"><Check className="size-3.5 text-[var(--color-success)]" />{plan.trial_days} {t("admin.plans.trialDays")}</div>}
        {plan.features && plan.features.length > 0 && <ul className="mb-3 space-y-1">{plan.features.map((f, i) => (<li key={i} className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]"><Check className="size-3 text-[var(--color-success)]" />{f}</li>))}</ul>}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]"><Users className="size-3.5" />{t("admin.plans.subscribers")}<Badge variant="success" className="ml-1.5">{plan.active_subscriptions}</Badge></div>
          <div className="flex items-center gap-1">
            <button onClick={() => onAction("edit")} className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] transition-colors" title={t("admin.plans.actionEdit")}><Pencil className="size-4" /></button>
            <button onClick={() => onAction("duplicate")} className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-info)]/10 hover:text-[var(--color-info)] transition-colors" title={t("admin.plans.actionDuplicate")}><Copy className="size-4" /></button>
            <button onClick={() => onAction("toggle")} className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)] transition-colors" title={plan.is_active ? t("admin.plans.actionDeactivate") : t("admin.plans.actionActivate")}>{plan.is_active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            <button onClick={() => onAction("delete")} className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)] transition-colors" title={t("admin.plans.actionDelete")}><Trash2 className="size-4" /></button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanFormDialog({ open, plan, onClose }: { open: boolean; plan: AdminPlanListItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const isEdit = !!plan?.id;
  const [form, setForm] = useState<AdminPlanInput>({ name: "", key: "", description: "", price_cents: 0, currency: "USD", interval: "monthly", trial_days: 0, limits: { ...DEFAULT_PLAN_LIMITS }, sort_order: 0, features: [], is_popular: false });
  const [limitsJson, setLimitsJson] = useState("");
  const [featuresText, setFeaturesText] = useState("");
  const [loading, setLoading] = useState(false);

  useMemo(() => {
    if (plan) { setForm({ name: plan.name, key: plan.key, description: plan.description, price_cents: plan.price_cents, currency: plan.currency, interval: plan.interval as any, trial_days: plan.trial_days, limits: plan.limits ?? { ...DEFAULT_PLAN_LIMITS }, sort_order: plan.sort_order, features: plan.features ?? [], is_popular: plan.is_popular ?? false }); setLimitsJson(JSON.stringify(plan.limits ?? DEFAULT_PLAN_LIMITS, null, 2)); setFeaturesText((plan.features ?? []).join("\n")); }
    else { setForm({ name: "", key: "", description: "", price_cents: 0, currency: "USD", interval: "monthly", trial_days: 0, limits: { ...DEFAULT_PLAN_LIMITS }, sort_order: 0, features: [], is_popular: false }); setLimitsJson(JSON.stringify(DEFAULT_PLAN_LIMITS, null, 2)); setFeaturesText(""); }
  }, [plan]);

  async function submit() {
    const key = isEdit ? form.key : form.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'plan-' + Date.now().toString(36);
    let limits: Record<string, number>;
    try { limits = JSON.parse(limitsJson || "{}"); } catch { toast({ type: "error", title: t("admin.plans.invalidLimits") }); return; }
    const features = featuresText.split("\n").map(s => s.trim()).filter(Boolean);
    setLoading(true);
    try {
      if (isEdit && plan) { await updatePlan.mutateAsync({ planId: plan.id, input: { ...form, limits, features } }); toast({ type: "success", title: t("admin.plans.updatedOk") }); }
      else { await createPlan.mutateAsync({ ...form, key, limits, features }); toast({ type: "success", title: t("admin.plans.createdOk") }); }
      onClose();
    } catch (e: any) { toast({ type: "error", title: e.message.includes("key_exists") ? t("admin.plans.keyExists") : e.message }); }
    finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose}><DialogHeader><DialogTitle>{isEdit ? t("admin.plans.editTitle") : t("admin.plans.createTitle")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
      <DialogBody className="space-y-4">
         <div><Label>{t("admin.plans.name")}</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Pro" /></div>
        <div><Label>{t("admin.plans.description")}</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t("admin.plans.descriptionPlaceholder")} /></div>
                 <div className="grid grid-cols-3 gap-3"><div><Label>{t("admin.plans.price")}</Label><Input type="text" inputMode="decimal" value={form.price_cents ? String(form.price_cents / 100) : "0"} onChange={e => { const n = parseFloat(e.target.value); setForm({ ...form, price_cents: isNaN(n) ? 0 : Math.round(n * 100) }); }} /></div><div><Label>{t("admin.plans.currency")}</Label><select value={form.currency ?? "USD"} onChange={e => setForm({ ...form, currency: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="USD">USD ($)</option><option value="SAR">SAR (﷼)</option><option value="EGP">EGP (E£)</option></select></div><div><Label>{t("admin.plans.interval")}</Label><select value={form.interval ?? "monthly"} onChange={e => setForm({ ...form, interval: e.target.value as any })} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="monthly">{t("admin.plans.month")}</option><option value="yearly">{t("admin.plans.year")}</option></select></div></div>
        <div className="grid grid-cols-2 gap-3"><div><Label>{t("admin.plans.trialDays")}</Label><Input type="text" inputMode="numeric" value={form.trial_days ?? 0} onChange={e => { const v = e.target.value; const n = parseInt(v, 10); setForm({ ...form, trial_days: v === "" ? 0 : isNaN(n) ? 0 : n }); }} /></div><div><Label>{t("admin.plans.sortOrder")}</Label><Input type="number" value={form.sort_order ?? 0} onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value || "0", 10) })} /></div></div>
        <div className="flex items-center gap-2"><input type="checkbox" id="is_popular" checked={form.is_popular ?? false} onChange={e => setForm({ ...form, is_popular: e.target.checked })} className="size-4 rounded border-[var(--color-border)]" /><Label htmlFor="is_popular">{t("admin.plans.isPopular")}</Label></div>
        <div><Label>{t("admin.plans.features")}</Label><textarea value={featuresText} onChange={e => setFeaturesText(e.target.value)} placeholder={t("admin.plans.featuresHint")} className="min-h-[100px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm" /></div>
        <div><div className="mb-1 flex items-center justify-between"><Label>{t("admin.plans.limits")}</Label><button onClick={() => setLimitsJson(JSON.stringify(DEFAULT_PLAN_LIMITS, null, 2))} className="text-xs text-[var(--color-primary)] hover:underline">{t("admin.plans.resetToDefaults")}</button></div><textarea value={limitsJson} onChange={e => setLimitsJson(e.target.value)} className="min-h-[180px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs" /><p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t("admin.plans.limitsHint")}</p></div>
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={submit} disabled={loading || !form.name}>{isEdit ? t("common.save") : t("admin.plans.create")}</Button></DialogFooter>
    </Dialog>
  );
}

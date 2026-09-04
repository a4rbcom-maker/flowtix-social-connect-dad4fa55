import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, RefreshCw, Trash2, Pencil, Wallet,
  CheckCircle2, XCircle, Loader2, ArrowUpDown,
  Eye, EyeOff, Key, Server, Sparkles, ToggleLeft, ToggleRight,
  Search, X as XIcon, ChevronDown, ChevronUp,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { InputIcon } from "@/components/ui/input-icon";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { kieService, type AiProviderAccount, DuplicateApiKeyError, InvalidApiKeyError } from "@/lib/kie-service";
import { useWaAiModelsAdmin } from "@/hooks/useWaAiModels";
import type { AiModel } from "@/lib/wa-ai-models";
import { KIE_CHAT_MODELS, KIE_CHAT_FAMILY_LABELS, type KieChatModel } from "@/lib/kie-chat-models-catalog";

export function AdminAiProvidersPage() {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  const [accounts, setAccounts] = useState<AiProviderAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<AiProviderAccount | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiProviderAccount | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formPriority, setFormPriority] = useState("0");
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [showPicker, setShowPicker] = useState(false);
  const [editModel, setEditModel] = useState<AiModel | null>(null);
  const [editModelForm, setEditModelForm] = useState({ display_name_en: "", display_name_ar: "", desc_en: "", desc_ar: "", is_premium: false });
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerFamily, setPickerFamily] = useState<KieChatModel["family"] | "all">("all");
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerSaving, setPickerSaving] = useState(false);
  const [pickerExpanded, setPickerExpanded] = useState<Record<KieChatModel["family"], boolean>>({ claude: true, gpt: true, gemini: true, grok: true });
  const [tab, setTab] = useState<"accounts" | "models">("accounts");

  const { query: modelsQuery, toggle: toggleModel, remove: removeModel, save: saveModel } = useWaAiModelsAdmin();

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setAccounts(await kieService.listAccounts(userId));
    } catch {
      toast({ type: "error", title: t("common.error") });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const total = accounts.reduce((sum, a) => sum + (Number(a.credits) || 0), 0);
  const activeCount = accounts.filter((a) => a.is_active).length;
  const firstWithCredits = accounts.find((a) => a.is_active && Number(a.credits) > 0);

  function formatCredits(value: number): string {
    const n = Number(value) || 0;
    return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  async function handleAdd() {
    if (!userId || !formName.trim() || !formApiKey.trim()) return;
    setSaving(true);
    try {
      await kieService.addAccount(userId, formName.trim(), formApiKey.trim(), parseInt(formPriority) || 0);
      toast({ type: "success", title: t("admin.aiProviders.added") });
      setShowAdd(false); setFormName(""); setFormApiKey(""); setFormPriority("0");
      await load();
    } catch (e: any) {
      if (e instanceof DuplicateApiKeyError) {
        toast({ type: "error", title: t("admin.aiProviders.errors.duplicateKey") });
      } else if (e instanceof InvalidApiKeyError) {
        toast({ type: "error", title: t("admin.aiProviders.errors.invalidKey") });
      } else {
        toast({ type: "error", title: t("common.error"), description: e.message });
      }
    }
    setSaving(false);
  }

  async function handleEdit() {
    if (!editTarget || !formName.trim()) return;
    setSaving(true);
    try {
      const updates: any = { name: formName.trim(), priority: parseInt(formPriority) || 0 };
      if (formApiKey.trim()) updates.api_key_enc = formApiKey.trim();
      await kieService.updateAccount(editTarget.id, updates);
      toast({ type: "success", title: t("admin.aiProviders.updated") });
      setShowEdit(false); setEditTarget(null); setFormName(""); setFormApiKey(""); setFormPriority("0");
      await load();
    } catch (e: any) {
      if (e instanceof DuplicateApiKeyError) {
        toast({ type: "error", title: t("admin.aiProviders.errors.duplicateKey") });
      } else if (e instanceof InvalidApiKeyError) {
        toast({ type: "error", title: t("admin.aiProviders.errors.invalidKey") });
      } else {
        toast({ type: "error", title: t("common.error"), description: e.message });
      }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try { await kieService.deleteAccount(deleteTarget.id); toast({ type: "success", title: t("admin.aiProviders.deleted") }); }
    catch { toast({ type: "error", title: t("common.error") }); }
    setShowDelete(false); setDeleteTarget(null); await load();
  }

  async function handleRefresh() {
    if (!userId) return;
    setRefreshing(true);
    try {
      setAccounts(await kieService.refreshAllCredits(userId));
      toast({ type: "success", title: t("admin.aiProviders.refreshed") });
    } catch { toast({ type: "error", title: t("common.error") }); }
    setRefreshing(false);
  }

  function openEdit(a: AiProviderAccount) { setEditTarget(a); setFormName(a.name); setFormApiKey(""); setFormPriority(String(a.priority)); setShowEdit(true); }
  function openDelete(a: AiProviderAccount) { setDeleteTarget(a); setShowDelete(true); }
  function maskKey(key: string) { return key.slice(0, 8) + "••••••••" + key.slice(-4); }

  function openPicker() {
    setPickerSearch("");
    setPickerFamily("all");
    // لا تحدد شيئاً افتراضياً — المستخدم يختار بنفسه
    setPickerSelected(new Set());
    setPickerExpanded({ claude: true, gpt: true, gemini: true, grok: true });
    setShowPicker(true);
  }

  const groupedCatalog = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const groups: Record<KieChatModel["family"], KieChatModel[]> = { claude: [], gpt: [], gemini: [], grok: [] };
    for (const m of KIE_CHAT_MODELS) {
      if (pickerFamily !== "all" && m.family !== pickerFamily) continue;
      if (q) {
        const hay = `${m.model_id} ${m.display_name_en} ${m.display_name_ar} ${m.desc_en} ${m.desc_ar}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      groups[m.family].push(m);
    }
    return groups;
  }, [pickerSearch, pickerFamily]);

  const visibleIds = useMemo(
    () => Object.values(groupedCatalog).flat().map((m) => m.model_id),
    [groupedCatalog],
  );

  function togglePick(modelId: string) {
    setPickerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  function togglePickFamily(family: KieChatModel["family"]) {
    const familyIds = groupedCatalog[family].filter((m) => !existingModelIds.has(m.model_id)).map((m) => m.model_id);
    if (familyIds.length === 0) return;
    setPickerSelected((prev) => {
      const allSelected = familyIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) familyIds.forEach((id) => next.delete(id));
      else familyIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function togglePickAllVisible() {
    const selectable = visibleIds.filter((id) => !existingModelIds.has(id));
    if (selectable.length === 0) return;
    setPickerSelected((prev) => {
      const allSelected = selectable.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) selectable.forEach((id) => next.delete(id));
      else selectable.forEach((id) => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setPickerSelected(new Set());
  }

  const existingModelIds = useMemo(
    () => new Set((modelsQuery.data ?? []).map((m) => m.model_id)),
    [modelsQuery.data],
  );

  async function handlePickerAdd() {
    if (pickerSelected.size === 0) return;
    setPickerSaving(true);
    const baseOrder = modelsQuery.data?.length ?? 0;
    const toAdd = KIE_CHAT_MODELS.filter((m) => pickerSelected.has(m.model_id));
    const created: { name: string; id: string }[] = [];
    const skipped: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    for (let i = 0; i < toAdd.length; i++) {
      const m = toAdd[i];
      try {
        await saveModel.mutateAsync({
          model_id: m.model_id,
          provider: "kie",
          display_name: { en: m.display_name_en, ar: m.display_name_ar },
          description: { en: m.desc_en, ar: m.desc_ar },
          is_premium: m.is_premium ?? false,
          is_active: true,
          sort_order: baseOrder + i + 1,
        });
        created.push({ name: m.display_name_en, id: m.model_id });
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? "");
        if (msg.includes("23505") || msg.includes("duplicate") || msg.includes("uniq")) {
          skipped.push(m.display_name_en);
        } else {
          failed.push({ name: m.display_name_en, reason: msg || "Unknown error" });
        }
      }
    }
    // إعادة تحميل القائمة فوراً لضمان ظهور الإضافات الجديدة
    await modelsQuery.refetch();
    setPickerSaving(false);
    if (created.length > 0) {
      toast({
        type: "success",
        title: t("admin.aiProviders.models.added", { count: created.length }),
        description: failed.length > 0 || skipped.length > 0 ? `${skipped.length} skipped · ${failed.length} failed` : undefined,
      });
    }
    if (skipped.length > 0 && created.length === 0) {
      toast({ type: "error", title: t("admin.aiProviders.models.allSkipped", { count: skipped.length }) });
    }
    if (failed.length > 0) {
      const detail = failed.slice(0, 3).map((f) => `${f.name}: ${f.reason}`).join(" · ");
      toast({
        type: "error",
        title: t("admin.aiProviders.models.failed", { count: failed.length }),
        description: detail + (failed.length > 3 ? ` (+${failed.length - 3} more)` : ""),
      });
    }
    if (created.length > 0) {
      setShowPicker(false);
    }
  }

  function openEditModel(m: AiModel) {
    setEditModel(m);
    setEditModelForm({
      display_name_en: m.display_name.en ?? "",
      display_name_ar: m.display_name.ar ?? "",
      desc_en: m.description.en ?? "",
      desc_ar: m.description.ar ?? "",
      is_premium: m.is_premium,
    });
  }

  async function handleEditModel() {
    if (!editModel || !editModelForm.display_name_en.trim()) return;
    try {
      await saveModel.mutateAsync({
        id: editModel.id,
        display_name: { en: editModelForm.display_name_en, ar: editModelForm.display_name_ar || editModelForm.display_name_en },
        description: { en: editModelForm.desc_en, ar: editModelForm.desc_ar || editModelForm.desc_en },
        is_premium: editModelForm.is_premium,
      });
      toast({ type: "success", title: "Model updated" });
      setEditModel(null);
    } catch (e: any) {
      toast({ type: "error", title: e.message || "Failed to update" });
    }
  }

  async function handleDeleteModel(id: string) {
    try { await removeModel.mutateAsync(id); toast({ type: "success", title: "Model deleted" }); }
    catch { toast({ type: "error", title: "Failed to delete" }); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.aiProviders.title")} description={t("admin.aiProviders.description")} icon={Wallet} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.aiProviders.totalBalance")} value={formatCredits(total)} icon={Wallet} />
        <StatCard label={t("admin.aiProviders.activeAccounts")} value={String(activeCount)} icon={CheckCircle2} />
        <StatCard label={t("admin.aiProviders.failoverTarget")} value={firstWithCredits?.name ?? "—"} icon={ArrowUpDown} />
        <StatCard label={t("admin.aiProviders.provider")} value="Kie.ai" icon={Server} />
      </div>

      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t("admin.aiProviders.accounts")}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="flex-1 sm:flex-none">
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              <span className="hidden sm:inline">{t("admin.aiProviders.refreshAll")}</span>
            </Button>
            <Button size="sm" onClick={() => { setFormName(""); setFormApiKey(""); setFormPriority("0"); setShowAdd(true); }} className="flex-1 sm:flex-none">
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("admin.aiProviders.add")}</span>
              <span className="sm:hidden">{t("admin.aiProviders.add", "Add")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Wallet className="size-12 text-[var(--color-fg-subtle)]" />
              <p className="text-sm text-[var(--color-fg-muted)]">{t("admin.aiProviders.empty")}</p>
              <Button onClick={() => { setFormName(""); setFormApiKey(""); setFormPriority("0"); setShowAdd(true); }}>
                <Plus className="size-4" />{t("admin.aiProviders.addFirst")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((a, idx) => (
                <div key={a.id} className={cn(
                  "flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border p-3 sm:p-4 transition-all",
                  a.is_active ? "border-[var(--color-border)]" : "border-[var(--color-border)] opacity-50"
                )}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg",
                      Number(a.credits) > 0 ? "bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]" : "bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)]"
                    )}>
                      {Number(a.credits) > 0 ? <CheckCircle2 className="size-5 text-[var(--color-success)]" /> : <XCircle className="size-5 text-[var(--color-warning)]" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--color-fg)] truncate">{a.name}</span>
                        {idx === 0 && <Badge variant="primary" className="text-xs shrink-0">{t("admin.aiProviders.primary")}</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 text-xs text-[var(--color-fg-subtle)]">
                        <span className="flex items-center gap-1 min-w-0">
                          <Key className="size-3 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {showKey[a.id] ? a.api_key_enc : maskKey(a.api_key_enc)}
                          </span>
                          <button onClick={() => setShowKey((s) => ({ ...s, [a.id]: !s[a.id] }))} className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] shrink-0">
                            {showKey[a.id] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                          </button>
                        </span>
                        <span className="shrink-0">Priority: {a.priority}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-2">
                    <div className="text-end shrink-0">
                      <p className={cn("text-lg font-extrabold", Number(a.credits) > 0 ? "text-[var(--color-success)]" : "text-[var(--color-warning)]")}>
                        {formatCredits(a.credits)}
                      </p>
                      <p className="text-[0.65rem] text-[var(--color-fg-subtle)]">{a.last_checked_at ? new Date(a.last_checked_at).toLocaleTimeString() : "—"}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(a)} className="size-9 p-0"><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => openDelete(a)} className="size-9 p-0"><Trash2 className="size-4 text-[var(--color-error)]" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab switcher */}
      <div className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <button onClick={() => setTab("accounts")} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all", tab === "accounts" ? "bg-gradient-brand text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>
          <Wallet className="size-4" /> Accounts
        </button>
        <button onClick={() => setTab("models")} className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all", tab === "models" ? "bg-gradient-brand text-white" : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>
          <Sparkles className="size-4" /> Models
        </button>
      </div>

      {/* Models tab */}
      {tab === "models" && (
        <Card>
          <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              {t("admin.aiProviders.models.title")}
              {modelsQuery.data && (
                <Badge variant="outline" className="text-xs font-normal">{modelsQuery.data.length}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => modelsQuery.refetch()} disabled={modelsQuery.isFetching} className="size-9 p-0">
                <RefreshCw className={cn("size-4", modelsQuery.isFetching && "animate-spin")} />
              </Button>
              <Button size="sm" onClick={openPicker}>
                <Plus className="size-4" /> {t("admin.aiProviders.models.browse")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {modelsQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <XCircle className="size-12 text-[var(--color-error)]" />
                <p className="text-sm font-semibold text-[var(--color-error)]">Failed to load models</p>
                <p className="text-xs text-[var(--color-fg-muted)] max-w-md">{String((modelsQuery.error as any)?.message ?? modelsQuery.error ?? "Unknown error")}</p>
                <Button variant="outline" size="sm" onClick={() => modelsQuery.refetch()}>
                  <RefreshCw className="size-4" /> Retry
                </Button>
              </div>
            ) : modelsQuery.isLoading ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : modelsQuery.data?.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Sparkles className="size-12 text-[var(--color-fg-subtle)]" />
                <p className="text-sm text-[var(--color-fg-muted)]">No models yet</p>
                <Button onClick={openPicker}>
                  <Plus className="size-4" /> {t("admin.aiProviders.models.browse")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {modelsQuery.data?.map((m) => (
                  <div key={m.id} className={cn("flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border p-3 sm:p-4 transition-all", m.is_active ? "border-[var(--color-border)]" : "border-[var(--color-border)] opacity-50")}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", m.is_active ? "bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)]" : "bg-[var(--color-surface-2)]")}>
                        <Sparkles className={cn("size-5", m.is_active ? "text-[var(--color-primary)]" : "text-[var(--color-fg-muted)]")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[var(--color-fg)] truncate">{m.display_name.en}</span>
                          <Badge variant="outline" className="text-xs">{m.provider}</Badge>
                          {m.is_premium && <Badge variant="warning" className="text-xs">Premium</Badge>}
                          {!m.is_active && <Badge variant="default" className="text-xs">Hidden</Badge>}
                        </div>
                        <p className="text-xs text-[var(--color-fg-subtle)] truncate">{m.model_id} • {m.description.en}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleModel.mutate({ id: m.id, isActive: !m.is_active })}
                        className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                          m.is_active
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                            : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]"
                        )}
                      >
                        {m.is_active ? <ToggleRight className="size-3.5" /> : <ToggleLeft className="size-3.5" />}
                        {m.is_active ? "Active" : "Hidden"}
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => openEditModel(m)} className="size-9 p-0"><Pencil className="size-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteModel(m.id)} className="size-9 p-0"><Trash2 className="size-4 text-[var(--color-error)]" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <DialogHeader><DialogTitle>{t("admin.aiProviders.addTitle")}</DialogTitle><DialogClose onClose={() => setShowAdd(false)} /></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.name")}</label><InputIcon icon={Pencil} value={formName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)} placeholder={t("admin.aiProviders.namePlaceholder")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.apiKey")}</label><InputIcon icon={Key} value={formApiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormApiKey(e.target.value)} placeholder="kie_..." type={showKey.add ? "text" : "password"} /><button onClick={() => setShowKey((s) => ({ ...s, add: !s.add }))} className="text-xs text-[var(--color-fg-muted)]">{showKey.add ? t("admin.aiProviders.hide") : t("admin.aiProviders.show")}</button></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.priorityLabel")}</label><InputIcon icon={ArrowUpDown} value={formPriority} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormPriority(e.target.value)} placeholder="0" /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowAdd(false)}>{t("common.cancel")}</Button>
          <Button disabled={!formName.trim() || !formApiKey.trim() || saving} onClick={handleAdd}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("admin.aiProviders.add")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Picker Dialog — choose from Kie.ai chat models catalog */}
      <Dialog open={showPicker} onClose={() => setShowPicker(false)} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("admin.aiProviders.models.browse")}</DialogTitle>
          <DialogClose onClose={() => setShowPicker(false)} />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="relative">
            <InputIcon icon={Search} value={pickerSearch} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPickerSearch(e.target.value)} placeholder={t("admin.aiProviders.models.search")} />
            {pickerSearch && (
              <button onClick={() => setPickerSearch("")} className="absolute end-2 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
                <XIcon className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setPickerFamily("all")}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                pickerFamily === "all"
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                  : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              All ({KIE_CHAT_MODELS.length})
            </button>
            {(Object.keys(KIE_CHAT_FAMILY_LABELS) as KieChatModel["family"][]).map((f) => {
              const count = KIE_CHAT_MODELS.filter((m) => m.family === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setPickerFamily(f)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                    pickerFamily === f
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {KIE_CHAT_FAMILY_LABELS[f].en} ({count})
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--color-fg)]">
              <span className="text-[var(--color-primary)]">{pickerSelected.size}</span>
              <span className="text-[var(--color-fg-muted)]"> / {visibleIds.filter((id) => !existingModelIds.has(id)).length} selected</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={togglePickAllVisible}
                disabled={visibleIds.filter((id) => !existingModelIds.has(id)).length === 0}
                className="text-xs font-semibold text-[var(--color-primary)] hover:underline disabled:opacity-50"
              >
                {t("admin.aiProviders.models.selectAll")}
              </button>
              <span className="text-[var(--color-border)]">·</span>
              <button
                onClick={clearSelection}
                disabled={pickerSelected.size === 0}
                className="text-xs font-semibold text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] disabled:opacity-50"
              >
                {t("admin.aiProviders.models.clear")}
              </button>
            </div>
          </div>

          <div className="space-y-2 pe-1">
            {visibleIds.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-fg-muted)]">{t("admin.aiProviders.models.noMatches")}</p>
            ) : (
              (Object.keys(groupedCatalog) as KieChatModel["family"][]).map((family) => {
                const models = groupedCatalog[family];
                if (models.length === 0) return null;
                const familySelectable = models.filter((m) => !existingModelIds.has(m.model_id));
                const familySelectedCount = familySelectable.filter((m) => pickerSelected.has(m.model_id)).length;
                const expanded = pickerExpanded[family];
                const allFamilySelected = familySelectable.length > 0 && familySelectedCount === familySelectable.length;
                return (
                  <div key={family} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setPickerExpanded((prev) => ({ ...prev, [family]: !prev[family] }))}
                      className="flex w-full items-center justify-between gap-2 bg-[var(--color-surface-2)] px-3 py-2 text-start transition-colors hover:bg-[var(--color-surface-3)]"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={allFamilySelected}
                          ref={(el) => { if (el) el.indeterminate = familySelectedCount > 0 && !allFamilySelected; }}
                          disabled={familySelectable.length === 0}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => togglePickFamily(family)}
                          className="size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                        />
                        <span className="text-sm font-bold text-[var(--color-fg)]">{KIE_CHAT_FAMILY_LABELS[family].en}</span>
                        <span className="text-xs text-[var(--color-fg-muted)]">
                          ({familySelectedCount}/{familySelectable.length}
                          {models.length - familySelectable.length > 0 ? ` · ${models.length - familySelectable.length} already added` : ""})
                        </span>
                      </div>
                      {expanded ? <ChevronUp className="size-4 text-[var(--color-fg-muted)]" /> : <ChevronDown className="size-4 text-[var(--color-fg-muted)]" />}
                    </button>
                    {expanded && (
                      <div className="space-y-1 p-2">
                        {models.map((m) => {
                          const isSelected = pickerSelected.has(m.model_id);
                          const alreadyExists = existingModelIds.has(m.model_id);
                          return (
                            <label
                              key={m.model_id}
                              className={cn(
                                "flex items-start gap-3 rounded-md border p-2.5 transition-all",
                                alreadyExists
                                  ? "border-[var(--color-border)] bg-[var(--color-surface-2)] opacity-60 cursor-not-allowed"
                                  : isSelected
                                    ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)] cursor-pointer"
                                    : "border-[var(--color-border)] hover:border-[var(--color-primary)]/60 cursor-pointer",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={alreadyExists}
                                onChange={() => togglePick(m.model_id)}
                                className="mt-0.5 size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-[var(--color-fg)]">{m.display_name_en}</span>
                                  <span className="text-[0.65rem] font-mono text-[var(--color-fg-subtle)]">{m.model_id}</span>
                                  {m.is_premium && <Badge variant="warning" className="text-[0.65rem]">Premium</Badge>}
                                  {alreadyExists && <Badge variant="default" className="text-[0.65rem]">{t("admin.aiProviders.models.added")}</Badge>}
                                </div>
                                <p className="text-xs text-[var(--color-fg-muted)] truncate">{m.desc_en}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogBody>
        <DialogFooter className="bg-[var(--color-surface-2)] px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-bold text-[var(--color-primary)]">{pickerSelected.size}</span>
              <span className="text-[var(--color-fg-muted)]"> model{pickerSelected.size === 1 ? "" : "s"} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowPicker(false)}>{t("common.cancel")}</Button>
              <Button disabled={pickerSelected.size === 0 || pickerSaving} onClick={handlePickerAdd} className="min-w-[120px]">
                {pickerSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add {pickerSelected.size > 0 ? `(${pickerSelected.size})` : ""}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </Dialog>

      {/* Edit Model Dialog */}
      <Dialog open={!!editModel} onClose={() => setEditModel(null)}>
        <DialogHeader>
          <DialogTitle>Edit Model</DialogTitle>
          <DialogClose onClose={() => setEditModel(null)} />
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <p className="text-xs text-[var(--color-fg-subtle)]">Model ID</p>
            <p className="text-sm font-mono font-semibold">{editModel?.model_id}</p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Display Name (English)</Label>
            <Input value={editModelForm.display_name_en} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditModelForm({ ...editModelForm, display_name_en: e.target.value })} placeholder="e.g. GPT-4o" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Display Name (Arabic)</Label>
            <Input value={editModelForm.display_name_ar} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditModelForm({ ...editModelForm, display_name_ar: e.target.value })} placeholder="e.g. جي بي تي 4o" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Description (English)</Label>
            <Input value={editModelForm.desc_en} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditModelForm({ ...editModelForm, desc_en: e.target.value })} placeholder="e.g. Strong reasoning" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Description (Arabic)</Label>
            <Input value={editModelForm.desc_ar} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditModelForm({ ...editModelForm, desc_ar: e.target.value })} placeholder="e.g. استدلال قوي" />
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={editModelForm.is_premium} onChange={(e) => setEditModelForm({ ...editModelForm, is_premium: e.target.checked })} className="size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]" />
            <Label className="text-sm font-medium">Premium only</Label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditModel(null)}>{t("common.cancel")}</Button>
          <Button disabled={!editModelForm.display_name_en.trim()} onClick={handleEditModel}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={showEdit} onClose={() => setShowEdit(false)}>
        <DialogHeader><DialogTitle>{t("admin.aiProviders.editTitle")}</DialogTitle><DialogClose onClose={() => setShowEdit(false)} /></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.name")}</label><InputIcon icon={Pencil} value={formName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormName(e.target.value)} placeholder={t("admin.aiProviders.namePlaceholder")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.newApiKey")}</label><InputIcon icon={Key} value={formApiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormApiKey(e.target.value)} placeholder={t("admin.aiProviders.apiKeyKeepEmpty")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.priorityLabel")}</label><InputIcon icon={ArrowUpDown} value={formPriority} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormPriority(e.target.value)} placeholder="0" /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowEdit(false)}>{t("common.cancel")}</Button>
          <Button disabled={!formName.trim() || saving} onClick={handleEdit}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}{t("common.save")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDelete} onClose={() => setShowDelete(false)}>
        <DialogHeader><DialogTitle>{t("admin.aiProviders.deleteTitle")}</DialogTitle><DialogClose onClose={() => setShowDelete(false)} /></DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]"><Trash2 className="size-8 text-[var(--color-error)]" /></div>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("admin.aiProviders.deleteConfirm", { name: deleteTarget?.name ?? "" })}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowDelete(false)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={handleDelete}><Trash2 className="size-4" />{t("common.delete")}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

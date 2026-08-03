import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, RefreshCw, Trash2, Pencil, Wallet,
  CheckCircle2, XCircle, Loader2, ArrowUpDown,
  Eye, EyeOff, Key, Server,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { kieService, type AiProviderAccount, DuplicateApiKeyError, InvalidApiKeyError } from "@/lib/kie-service";

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

      {/* Add Dialog */}
      <Dialog open={showAdd} onClose={() => setShowAdd(false)}>
        <DialogHeader><DialogTitle>{t("admin.aiProviders.addTitle")}</DialogTitle><DialogClose onClose={() => setShowAdd(false)} /></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.name")}</label><InputIcon icon={Pencil} value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("admin.aiProviders.namePlaceholder")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.apiKey")}</label><InputIcon icon={Key} value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="kie_..." type={showKey.add ? "text" : "password"} /><button onClick={() => setShowKey((s) => ({ ...s, add: !s.add }))} className="text-xs text-[var(--color-fg-muted)]">{showKey.add ? t("admin.aiProviders.hide") : t("admin.aiProviders.show")}</button></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.priorityLabel")}</label><InputIcon icon={ArrowUpDown} value={formPriority} onChange={(e) => setFormPriority(e.target.value)} placeholder="0" /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowAdd(false)}>{t("common.cancel")}</Button>
          <Button disabled={!formName.trim() || !formApiKey.trim() || saving} onClick={handleAdd}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("admin.aiProviders.add")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onClose={() => setShowEdit(false)}>
        <DialogHeader><DialogTitle>{t("admin.aiProviders.editTitle")}</DialogTitle><DialogClose onClose={() => setShowEdit(false)} /></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.name")}</label><InputIcon icon={Pencil} value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t("admin.aiProviders.namePlaceholder")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.newApiKey")}</label><InputIcon icon={Key} value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder={t("admin.aiProviders.apiKeyKeepEmpty")} /></div>
          <div className="space-y-2"><label className="text-sm font-medium">{t("admin.aiProviders.priorityLabel")}</label><InputIcon icon={ArrowUpDown} value={formPriority} onChange={(e) => setFormPriority(e.target.value)} placeholder="0" /></div>
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

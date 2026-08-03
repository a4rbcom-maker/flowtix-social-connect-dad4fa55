import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  Plug, Search, Plus, WifiOff, AlertTriangle, Pause, Clock, Wifi,
  Eye, Pencil, RefreshCw, Trash2, MoreVertical,
  CheckCircle2, QrCode, Smartphone, Loader2, Globe, MessageCircle,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputIcon } from "@/components/ui/input-icon";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  useWaSessions, useWaSessionStats, useWaSessionMutations, type WaSessionStatus,
} from "@/hooks/useWaSessions";

const statusConfig: Record<WaSessionStatus, { variant: "success" | "primary" | "default" | "warning" | "error"; icon: typeof WifiOff; dot: string }> = {
  connected: { variant: "success", icon: CheckCircle2, dot: "bg-[var(--color-success)]" },
  connecting: { variant: "primary", icon: Clock, dot: "bg-[var(--color-primary)]" },
  qr_ready: { variant: "warning", icon: QrCode, dot: "bg-[var(--color-warning)]" },
  authenticating: { variant: "primary", icon: Loader2, dot: "bg-[var(--color-primary)]" },
  disconnected: { variant: "default", icon: WifiOff, dot: "bg-[var(--color-fg-subtle)]" },
  reconnecting: { variant: "primary", icon: RefreshCw, dot: "bg-[var(--color-primary)]" },
  paused: { variant: "default", icon: Pause, dot: "bg-[var(--color-fg-subtle)]" },
  expired: { variant: "warning", icon: Clock, dot: "bg-[var(--color-warning)]" },
  error: { variant: "error", icon: AlertTriangle, dot: "bg-[var(--color-error)]" },
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin} د`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `قبل ${diffH} س`;
  return `قبل ${Math.floor(diffH / 24)} يوم`;
}

export function WaSessionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("baileys");
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const { data: sessions, isLoading } = useWaSessions(statusFilter ? { status: statusFilter as WaSessionStatus } : undefined);
  const { data: stats } = useWaSessionStats();
  const mutations = useWaSessionMutations();

  const filtered = useMemo(() => {
    if (!sessions) return [];
    if (!search) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(s => s.name?.toLowerCase().includes(q) || s.phone_number?.includes(q));
  }, [sessions, search]);

  const handleCreate = () => {
    mutations.create.mutate({ name: name.trim(), providerType: provider as "baileys" | "cloud_api" }, {
      onSuccess: (result) => {
        setShowAdd(false); setName(""); setProvider("baileys"); setStep(1);
        navigate(`/dashboard/whatsapp/connect?id=${result.id}`);
        toast({ type: "success", title: t("wa.sessions.add.success") });
      },
      onError: (err) => {
        toast({ type: "error", title: t("common.error"), description: err.message });
      },
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("wa.sessions.title")} description={t("wa.sessions.subtitle")} icon={Smartphone} />

<div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("waSessions.stats.total")} value={stats?.total ?? 0} icon={MessageCircle} />
        <StatCard label={t("waSessions.stats.connected")} value={stats?.connected ?? 0} icon={Wifi} accent="success" />
        <StatCard label={t("waSessions.stats.disconnected")} value={stats?.disconnected ?? 0} icon={WifiOff} />
        <StatCard label={t("waSessions.stats.expired")} value={stats?.expired ?? 0} icon={Clock} accent="warning" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <InputIcon icon={Search} />
          <Input placeholder={t("wa.sessions.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10 min-w-[140px]">
          <option value="">{t("wa.sessions.filters.allStatuses")}</option>
          {Object.keys(statusConfig).map(s => <option key={s} value={s}>{t(`wa.sessions.status.${s}`)}</option>)}
        </select>
        <Button onClick={() => { setShowAdd(true); setStep(1); }}><Plus className="size-4" /> {t("wa.sessions.add.title")}</Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t("wa.sessions.empty.title")} description={t("wa.sessions.empty.description")} icon={Plug}
          action={<Button onClick={() => { setShowAdd(true); setStep(1); }}><Plus className="size-4" /> {t("wa.sessions.add.title")}</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(session => {
            const cfg = statusConfig[session.status as WaSessionStatus] ?? statusConfig.disconnected;
            const Icon = cfg.icon;
            return (
              <Card key={session.id} className="relative">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("size-10 rounded-xl flex items-center justify-center shrink-0", `bg-[var(--color-${cfg.variant === 'success' ? 'success' : cfg.variant === 'error' ? 'error' : cfg.variant === 'warning' ? 'warning' : 'surface-2'})]/10`)}>
                        <Icon className={cn("size-5", cfg.variant === 'primary' && "animate-spin text-[var(--color-primary)]")} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{session.name}</p>
                        <p className="text-xs text-[var(--color-fg-muted)]">{session.phone_number || "—"} {session.push_name ? `• ${session.push_name}` : ""}</p>
                      </div>
                    </div>
                    <div className="relative">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setActionMenuId(actionMenuId === session.id ? null : session.id)}>
                        <MoreVertical className="size-4" />
                      </Button>
                      {actionMenuId === session.id && (
                        <div className="absolute right-0 top-10 z-10 w-44 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-xl py-1" onClick={() => setActionMenuId(null)}>
                          <Link to={`/dashboard/whatsapp/sessions/${session.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"><Eye className="size-3.5" /> {t("wa.sessions.actions.view")}</Link>
                          <button className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] w-full text-start"
                            onClick={() => { const n = prompt(t("wa.sessions.actions.rename") || "Rename", session.name || ""); if (n) mutations.rename.mutate({ id: session.id, name: n }, { onSuccess: () => toast({ type: "success", title: t("wa.sessions.actions.renameDone") }) }); }}>
                            <Pencil className="size-3.5" /> {t("wa.sessions.actions.rename")}
                          </button>
                          {session.status !== "connected" && (
                            <Link to={`/dashboard/whatsapp/connect?id=${session.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"><QrCode className="size-3.5" /> {t("wa.sessions.actions.connectQR")}</Link>
                          )}
                          <button className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-error)] hover:bg-[var(--color-error)]/10 w-full text-start"
                            onClick={() => { if (confirm(t("wa.sessions.actions.delete") + "?")) mutations.delete.mutate(session.id, { onSuccess: () => toast({ type: "success", title: t("wa.sessions.actions.deleteDone") }) }); }}>
                            <Trash2 className="size-3.5" /> {t("wa.sessions.actions.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("size-2 rounded-full", cfg.dot)} />
                    <Badge variant={cfg.variant === "primary" ? "primary" : cfg.variant === "success" ? "success" : cfg.variant === "error" ? "error" : cfg.variant === "warning" ? "warning" : "default"} className="text-xs">
                      {t(`wa.sessions.status.${session.status}`)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{session.provider_type === "cloud_api" ? "API" : "QR"}</Badge>
                  </div>
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("wa.sessions.fields.lastActivity")}: {formatRelativeTime(session.last_activity)}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Dialog — 3 steps */}
      <Dialog open={showAdd} onClose={() => { setShowAdd(false); setName(""); setStep(1); }}>
        <DialogHeader>
          <DialogTitle>{t("wa.sessions.add.title")}</DialogTitle>
          <DialogClose onClose={() => { setShowAdd(false); setName(""); setStep(1); }} />
        </DialogHeader>
        <DialogBody>
          {step === 1 && (
            <div className="space-y-4 py-2">
              <p className="text-sm font-medium">{t("wa.sessions.add.step1Title")}</p>
              <p className="text-xs text-[var(--color-fg-muted)]">{t("wa.sessions.add.step1Desc")}</p>
              <Input placeholder={t("wa.sessions.add.sessionNamePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4 py-2">
              <p className="text-sm font-medium">{t("wa.sessions.add.step2Title")}</p>
              <div className="grid gap-3">
                <button onClick={() => setProvider("baileys")} className={cn("flex items-start gap-3 p-4 rounded-xl border-2 text-start transition-colors", provider === "baileys" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]")}>
                  <QrCode className="size-8 text-[var(--color-primary)] shrink-0 mt-1" />
                  <div><p className="font-semibold">{t("wa.sessions.add.providerBaileys")}</p><p className="text-xs text-[var(--color-fg-muted)]">{t("wa.sessions.add.providerBaileysDesc")}</p></div>
                </button>
                <button onClick={() => setProvider("cloud_api")} className={cn("flex items-start gap-3 p-4 rounded-xl border-2 text-start transition-colors", provider === "cloud_api" ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]")}>
                  <Globe className="size-8 text-[var(--color-primary)] shrink-0 mt-1" />
                  <div><p className="font-semibold">{t("wa.sessions.add.providerCloudApi")}</p><p className="text-xs text-[var(--color-fg-muted)]">{t("wa.sessions.add.providerCloudApiDesc")}</p></div>
                </button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4 py-2">
              <p className="text-sm font-medium">{t("wa.sessions.add.step3Title")}</p>
              <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.add.sessionName")}:</span><span className="font-semibold">{name}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.add.step2Title")}:</span><span className="font-semibold">{provider === "baileys" ? t("wa.sessions.add.providerBaileys") : t("wa.sessions.add.providerCloudApi")}</span></div>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("wa.sessions.add.back")}</Button>}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !name.trim()}>{t("wa.sessions.add.next")}</Button>
          ) : (
            <Button onClick={handleCreate} disabled={mutations.create.isPending}>{mutations.create.isPending ? <Loader2 className="size-4 animate-spin" /> : null} {t("wa.sessions.add.finish")}</Button>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  );
}

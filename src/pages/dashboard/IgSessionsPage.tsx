import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Camera, Search, Plus, WifiOff, AlertTriangle, CheckCircle2, Loader2,
  Cookie, Eye, Trash2, Activity, Pencil, Clock,
} from "lucide-react";
import { StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { InputIcon } from "@/components/ui/input-icon";
import { Textarea } from "@/components/ui/form";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { parseIgCookieStringDetailed } from "@/lib/cookie-parser";
import { useIgSessions, useIgSessionMutations } from "@/hooks/useIgSessions";
import { useAuth } from "@/lib/authProvider";

const statusConfig: Record<string, { variant: "success" | "default" | "warning" | "error"; labelKey: string }> = {
  connected: { variant: "success", labelKey: "ig_sessions.status.connected" },
  disconnected: { variant: "default", labelKey: "ig_sessions.status.disconnected" },
  needs_login: { variant: "warning", labelKey: "ig_sessions.status.needs_login" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString();
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function IgSessionsPage() {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [cookieString, setCookieString] = useState("");
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: sessions, isLoading, error } = useIgSessions();
  const mutations = useIgSessionMutations();

  const cookieResult = cookieString ? parseIgCookieStringDetailed(cookieString) : null;
  const cookieValid = cookieResult ? cookieResult.missingEssential.length === 0 : false;

  const statusCounts = useMemo(() => {
    const counts = { connected: 0, disconnected: 0, needs_login: 0, total: 0 };
    if (!sessions) return counts;
    for (const s of sessions) {
      counts.total++;
      if (s.status === "connected") counts.connected++;
      else if (s.status === "disconnected" || s.status === "needs_login") counts.disconnected++;
    }
    return counts;
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    return sessions.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.ig_username ?? "").toLowerCase().includes(search.toLowerCase()));
  }, [sessions, search]);

  function handleImport() {
    if (!sessionName.trim() || !cookieValid || !userId) return;
    const cookieResult = parseIgCookieStringDetailed(cookieString);
    const cookiesArray = Object.entries(cookieResult.cookies).map(([name, value]) => ({ name, value }));
    mutations.import.mutate(
      { user_id: userId, name: sessionName.trim(), cookies: cookiesArray },
      {
        onSuccess: () => {
          setShowImport(false);
          setSessionName("");
          setCookieString("");
          toast({ type: "success", title: t("ig_sessions.importDone"), description: sessionName });
        },
        onError: (err) => toast({ type: "error", title: t("common.error"), description: err.message }),
      },
    );
  }

  function handleCheck(id: string) {
    setTestingIds((prev) => new Set(prev).add(id));
    mutations.check.mutate(id, {
      onSuccess: (result) => {
        const ok = result.status === "connected";
        toast({
          type: ok ? "success" : "error",
          title: ok ? t("ig_sessions.checkDone") : t("common.error"),
          description: ok ? "" : "Session disconnected",
        });
      },
      onError: (err) => {
        toast({ type: "error", title: t("common.error"), description: err.message });
      },
      onSettled: () => {
        setTestingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
    });
  }

  function handleDelete(id: string) {
    setConfirmDelete(null);
    mutations.delete.mutate(id, {
      onSuccess: () => toast({ type: "success", title: t("ig_sessions.deleteDone") }),
      onError: (err) => toast({ type: "error", title: t("common.error"), description: err.message }),
    });
  }

  if (error) {
    return <ErrorState title={t("common.error")} description={error.message} icon={AlertTriangle} action={{ label: t("common.retry"), onClick: () => window.location.reload() }} />;
  }

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface-2)] to-[var(--color-surface)] p-6 sm:p-8">
        <div className="absolute inset-0 bg-grid opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" />
        <div className="absolute -top-20 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/20 to-transparent blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-brand opacity-50 blur-xl" />
              <div className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                <Camera className="size-7" />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">{t("ig_sessions.title")}</h1>
                <Badge variant="primary" className="gap-1">{sessions?.length ?? 0}</Badge>
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-[var(--color-fg-muted)]">{t("ig_sessions.subtitle")}</p>
            </div>
          </div>
          <Button onClick={() => setShowImport(true)} size="lg" className="gap-2 shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
            <Plus className="size-5" />{t("ig_sessions.import")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <StatCard label={t("ig_sessions.stats.connected")} value={statusCounts.connected} icon={CheckCircle2} />
        <StatCard label={t("ig_sessions.stats.disconnected")} value={statusCounts.disconnected} icon={WifiOff} />
        <StatCard label={t("ig_sessions.stats.total")} value={statusCounts.total} icon={Camera} />
      </div>

      {/* Search */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <Input type="search" placeholder={t("ig_sessions.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 ps-10" />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="space-y-2 flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div></div>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={sessions?.length === 0 ? t("ig_sessions.empty.title") : "No matches"}
          description={sessions?.length === 0 ? t("ig_sessions.empty.description") : t("ig_sessions.searchPlaceholder")}
          icon={Camera}
          action={sessions?.length === 0 ? <Button onClick={() => setShowImport(true)} size="lg" className="gap-2"><Plus className="size-4" />{t("ig_sessions.import")}</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((session) => {
            const cfg = statusConfig[session.status] || statusConfig.disconnected;
            const isTesting = testingIds.has(session.id);
            return (
              <Card key={session.id} className={cn("group relative overflow-hidden border-[var(--color-border)] transition-all duration-300 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-lg)]", isTesting && "ring-2 ring-[var(--color-primary)]/40")}>
                {isTesting && (
                  <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
                    <div className="absolute inset-x-0 -top-1 h-1 bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent animate-[scan_1.4s_ease-in-out_infinite]" />
                  </div>
                )}
                <CardContent className="relative space-y-4 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar fallback={session.ig_username ?? session.name} src={session.avatar_url ?? undefined} size="md" />
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-[var(--color-fg)]">{session.name}</h3>
                        <p className="truncate text-xs text-[var(--color-fg-subtle)]">@{session.ig_username ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("size-2.5 rounded-full", session.status === "connected" ? "bg-[var(--color-success)]" : "bg-[var(--color-fg-subtle)]")} />
                    <Badge variant={cfg.variant}>{t(cfg.labelKey)}</Badge>
                    {isTesting && <Badge variant="primary" className="gap-1"><Loader2 className="size-3.5 animate-spin" />{t("ig_sessions.testing")}</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
                      <Clock className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                      <span className="truncate text-[var(--color-fg-muted)]">{formatRelative(session.last_checked_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)]/60 px-2.5 py-1.5">
                      <Cookie className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                      <span className="truncate text-[var(--color-fg-muted)]">{formatDate(session.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-3">
                    <Button variant="outline" size="sm" onClick={() => handleCheck(session.id)} disabled={isTesting || mutations.delete.isPending} className="flex-1 gap-1.5">
                      {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
                      {isTesting ? t("ig_sessions.testing") : t("ig_sessions.check")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete({ id: session.id, name: session.name })} disabled={isTesting} className="text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onClose={() => setShowImport(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand text-white"><Cookie className="size-4" /></div>
            {t("ig_sessions.import")}
          </DialogTitle>
          <DialogClose onClose={() => setShowImport(false)} />
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--color-fg)]">{t("ig_sessions.importName")}</label>
            <InputIcon icon={Pencil} placeholder={t("ig_sessions.importNamePlaceholder")} value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[var(--color-fg)]">{t("ig_sessions.importCookies")}</label>
            <Textarea className="min-h-[140px] w-full font-mono text-xs leading-relaxed" placeholder={t("ig_sessions.importCookiesPlaceholder")} value={cookieString} onChange={(e) => setCookieString(e.target.value)} />
            {cookieResult && cookieResult.format !== "unknown" && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                <Eye className="size-3.5" />
                <span>{cookieResult.count} cookies detected</span>
              </div>
            )}
          </div>
          {cookieResult && (
            <div className={cn("rounded-xl border p-3 transition-all", cookieValid ? "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)]" : "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)]")}>
              <div className="flex items-start gap-2">
                {cookieValid ? <CheckCircle2 className="size-5 text-[var(--color-success)] shrink-0" /> : <AlertTriangle className="size-5 text-[var(--color-warning)] shrink-0" />}
                <div className="text-sm flex-1">
                  <p className={cn("font-semibold", cookieValid ? "text-[var(--color-success)]" : "text-[var(--color-warning)]")}>
                    {cookieValid ? t("ig_sessions.cookiesValid") : t("ig_sessions.cookiesPartial")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {cookieResult.foundEssential.map((k) => <Badge key={k} variant="success" className="text-xs">{k} ✓</Badge>)}
                    {cookieResult.missingEssential.map((k) => <Badge key={k} variant="warning" className="text-xs">{k} ✗</Badge>)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowImport(false)}>{t("common.cancel")}</Button>
          <Button disabled={!sessionName.trim() || !cookieValid || mutations.import.isPending || !userId} onClick={handleImport} className="gap-2">
            {mutations.import.isPending ? <Loader2 className="size-4 animate-spin" /> : <Cookie className="size-4" />}
            {t("ig_sessions.importAction")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)] text-[var(--color-error)]"><Trash2 className="size-4" /></div>
            {t("ig_sessions.deleteConfirm")}
          </DialogTitle>
          <DialogClose onClose={() => setConfirmDelete(null)} />
        </DialogHeader>
        <DialogBody>
          {confirmDelete && <p className="text-sm text-[var(--color-fg)]">{t("ig_sessions.deleteQuestion", { name: confirmDelete.name })}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>{t("common.no")}</Button>
          <Button variant="danger" onClick={() => handleDelete(confirmDelete!.id)} className="gap-2">{t("common.yes")}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

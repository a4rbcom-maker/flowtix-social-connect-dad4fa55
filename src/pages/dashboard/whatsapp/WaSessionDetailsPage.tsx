import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Clock, Phone, Activity, History, FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useWaSession, useWaSessionEvents, useWaSessionActivity, useWaSessionLifecycleLogs, useWaSessionMutations } from "@/hooks/useWaSessions";
import type { WaSessionStatus } from "@/types/wa.types";

const statusBadge: Record<WaSessionStatus, "success" | "primary" | "default" | "warning" | "error"> = {
  connected: "success", connecting: "primary", qr_ready: "warning", authenticating: "primary",
  disconnected: "default", reconnecting: "primary", paused: "default", expired: "warning", error: "error",
};

type Tab = "overview" | "activity" | "events" | "logs";

export function WaSessionDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");
  const { data: session, isLoading } = useWaSession(id);
  const { data: events } = useWaSessionEvents(id);
  const { data: activity } = useWaSessionActivity(id);
  const { data: logs } = useWaSessionLifecycleLogs(id);
  const mutations = useWaSessionMutations();

  if (isLoading || !session) return <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div>;

  const status = session.status as WaSessionStatus;
  const sBadge = statusBadge[status] ?? "default";

  return (
    <div className="space-y-6">
      <PageHeader title={session.name || "—"} icon={Phone} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={sBadge} className="text-sm px-3 py-1">{t(`wa.sessions.status.${status}`)}</Badge>
        <Badge variant="outline" className="text-sm">{session.provider_type === "cloud_api" ? "API" : "QR"}</Badge>
        {session.phone_number && <span className="text-sm text-[var(--color-fg-muted)]">{session.phone_number}</span>}
        {session.push_name && <span className="text-sm text-[var(--color-fg-muted)]">({session.push_name})</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === "connected" && <Button size="sm" variant="outline" onClick={() => mutations.disconnect.mutate({ id: session.id }, { onSuccess: () => toast({ type: "success", title: t("wa.sessions.actions.disconnectDone") }) })}>{t("wa.sessions.actions.disconnect")}</Button>}
        {status === "paused" && <Button size="sm" variant="outline" onClick={() => mutations.resume.mutate(session.id, { onSuccess: () => toast({ type: "success", title: t("wa.sessions.actions.resumeDone") }) })}>{t("wa.sessions.actions.resume")}</Button>}
        {status === "connected" && <Button size="sm" variant="outline" onClick={() => mutations.pause.mutate(session.id, { onSuccess: () => toast({ type: "success", title: t("wa.sessions.actions.pauseDone") }) })}>{t("wa.sessions.actions.pause")}</Button>}
        {(status === "disconnected" || status === "expired") && <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/whatsapp/connect?id=${session.id}`)}>{t("wa.sessions.actions.connectQR")}</Button>}
        <Button size="sm" variant="ghost" onClick={() => mutations.refresh.mutate(session.id)}><Loader2 className={cn("size-3.5", mutations.refresh.isPending && "animate-spin")} /></Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {([["overview", Activity, "overview"], ["activity", History, "activity"], ["events", FileText, "events"], ["logs", FileText, "logs"]] as const).map(([key, Icon, label]) => (
          <button key={key} onClick={() => setTab(key)} className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors",
            tab === key ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>
            <Icon className="size-4" />{label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Card>
          <CardContent className="p-6 grid gap-3 text-sm">
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.phone")}:</span><span>{session.phone_number || "—"}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.pushName")}:</span><span>{session.push_name || "—"}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.provider")}:</span><span>{session.provider_type}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.created")}:</span><span>{session.created_at ? new Date(session.created_at).toLocaleString() : "—"}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.lastActivity")}:</span><span>{session.last_activity ? new Date(session.last_activity).toLocaleString() : "—"}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-fg-muted)]">{t("wa.sessions.fields.lastConnection")}:</span><span>{session.last_connected ? new Date(session.last_connected).toLocaleString() : "—"}</span></div>
          </CardContent>
        </Card>
      )}

      {tab === "activity" && (
        <Card><CardContent className="p-4 space-y-2">
          {!activity?.length ? <p className="text-xs text-[var(--color-fg-muted)] text-center py-4">—</p> : activity.slice(0, 20).map(a => (
            <div key={a.id} className="flex items-center gap-2 text-xs border-b border-[var(--color-border)] last:border-0 py-1.5"><Clock className="size-3 text-[var(--color-fg-muted)]" /><span className="font-medium">{a.action}</span><span className="text-[var(--color-fg-muted)]">{a.description}</span><span className="text-[var(--color-fg-muted)] mr-auto">{a.created_at ? new Date(a.created_at).toLocaleTimeString() : ""}</span></div>
          ))}
        </CardContent></Card>
      )}

      {tab === "events" && (
        <Card><CardContent className="p-4 space-y-2">
          {!events?.length ? <p className="text-xs text-[var(--color-fg-muted)] text-center py-4">—</p> : events.slice(0, 20).map(e => (
            <div key={e.id} className="flex items-center gap-2 text-xs border-b border-[var(--color-border)] last:border-0 py-1.5"><span className="font-medium">{e.event_type}</span><span className="text-[var(--color-fg-muted)]">{e.description}</span><span className="text-[var(--color-fg-muted)] mr-auto">{e.created_at ? new Date(e.created_at).toLocaleTimeString() : ""}</span></div>
          ))}
        </CardContent></Card>
      )}

      {tab === "logs" && (
        <Card><CardContent className="p-4 space-y-2">
          {!logs?.length ? <p className="text-xs text-[var(--color-fg-muted)] text-center py-4">—</p> : logs.slice(0, 20).map(l => (
            <div key={l.id} className="flex items-center gap-2 text-xs border-b border-[var(--color-border)] last:border-0 py-1.5"><span className="font-medium">{l.action}</span><span className="text-[var(--color-fg-muted)]">{l.reason}</span><span className="text-[var(--color-fg-muted)] mr-auto">{l.created_at ? new Date(l.created_at).toLocaleTimeString() : ""}</span></div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}

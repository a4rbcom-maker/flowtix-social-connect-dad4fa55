import { Link } from "react-router-dom";
import { Plug, Plus, X, ShieldCheck, AlertCircle, Info } from "lucide-react";
import { Select } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useActiveSessionsForSelect, useSessions } from "@/hooks/useFbSessions";
import { useTranslation } from "react-i18next";

interface Props {
  primarySessionId: string;
  onPrimarySessionChange: (id: string) => void;
  secondarySessionIds: string[];
  onSecondarySessionIdsChange: (ids: string[]) => void;
  label?: string;
}

export function FbMultiSessionSelector({
  primarySessionId,
  onPrimarySessionChange,
  secondarySessionIds,
  onSecondarySessionIdsChange,
  label,
}: Props) {
  const { t } = useTranslation();
  const activeSessions = useActiveSessionsForSelect();
  const allSessions = useSessions();

  if (!activeSessions.data || activeSessions.data.length === 0) {
    return (
      <EmptyState
        title={t("sessions.empty.title")}
        description={t("sessions.empty.description")}
        icon={Plug}
        action={
          <Button asChild>
            <Link to="/dashboard/facebook/sessions">
              <Plug className="size-4" />
              {t("sessions.add.title")}
            </Link>
          </Button>
        }
      />
    );
  }

  const totalSelected = (primarySessionId ? 1 : 0) + secondarySessionIds.length;

  const handlePrimaryChange = (id: string) => {
    onPrimarySessionChange(id);
    onSecondarySessionIdsChange(secondarySessionIds.filter((sid) => sid !== id));
  };

  const toggleSecondary = (id: string) => {
    if (id === primarySessionId) return;
    if (secondarySessionIds.includes(id)) {
      onSecondarySessionIdsChange(secondarySessionIds.filter((sid) => sid !== id));
    } else {
      onSecondarySessionIdsChange([...secondarySessionIds, id]);
    }
  };

  const connectedSessions = (allSessions.data || []).filter(
    (s: any) => s.status === "connected",
  );
  const secondaryOptions = connectedSessions.filter((s: any) => s.id !== primarySessionId);
  const hasMultipleConnected = connectedSessions.length > 1;

  return (
    <div className="space-y-4">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--color-fg)]">{label}</label>
          {totalSelected > 1 && (
            <Badge variant="primary" className="gap-1">
              <ShieldCheck className="size-3" />
              {totalSelected} {t("extract.sessionsSelected", { defaultValue: "sessions" })}
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">
          {t("extract.primarySession", { defaultValue: "Primary session (used for login & scroll)" })}
        </label>
        <Select
          value={primarySessionId}
          onValueChange={handlePrimaryChange}
          options={[
            { value: "", label: t("extract.chooseSession") },
            ...activeSessions.data,
          ]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">
            {t("extract.secondarySessions", { defaultValue: "Additional sessions (auto-rotation on rate limit)" })}
          </label>
          {totalSelected > 1 && (
            <Badge variant="success" className="gap-1 text-[10px]">
              <ShieldCheck className="size-3" />
              +{secondarySessionIds.length} {t("extract.extraActive", { defaultValue: "extra" })}
            </Badge>
          )}
        </div>

        {hasMultipleConnected ? (
          <>
            <div className="flex flex-wrap gap-2">
              {secondaryOptions.map((session: any) => {
                const isSelected = secondarySessionIds.includes(session.id);
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => toggleSecondary(session.id)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)]"
                    }`}
                  >
                    {isSelected ? <X className="size-3" /> : <Plus className="size-3" />}
                    <span>{session.name || session.fb_user_name || session.id.slice(0, 8)}</span>
                  </button>
                );
              })}
            </div>
            {totalSelected > 1 ? (
              <p className="text-xs text-[var(--color-success)] flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                {t("extract.rotationHint", {
                  defaultValue: "System will auto-rotate between {{count}} sessions when Facebook rate-limits one.",
                  count: totalSelected,
                })}
              </p>
            ) : (
              <p className="text-xs text-[var(--color-fg-muted)] flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0" />
                {t("extract.secondaryHint", {
                  defaultValue: "Click one or more sessions above to enable auto-rotation. More sessions = higher extraction coverage.",
                })}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-3 space-y-2">
            <p className="text-xs text-[var(--color-fg)] flex items-start gap-1.5">
              <AlertCircle className="size-3.5 shrink-0 text-[var(--color-warning)] mt-0.5" />
              <span>
                {t("extract.needMoreSessions", {
                  defaultValue: "You only have one connected session. Add 2-3 more Facebook accounts to dramatically improve extraction coverage (from ~15% to 85%+).",
                })}
              </span>
            </p>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/dashboard/facebook/sessions">
                <Plus className="size-3.5" />
                {t("sessions.add.title", { defaultValue: "Add session" })}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

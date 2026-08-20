import { Link } from "react-router-dom";
import { Plug, Plus, X, ShieldCheck, AlertCircle, Info } from "lucide-react";
import { Select } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIgSessions } from "@/hooks/useIgSessions";
import { useTranslation } from "react-i18next";

interface Props {
  primarySessionId: string;
  onPrimarySessionChange: (id: string) => void;
  secondarySessionIds: string[];
  onSecondarySessionIdsChange: (ids: string[]) => void;
  label?: string;
}

export function IgMultiSessionSelector({
  primarySessionId,
  onPrimarySessionChange,
  secondarySessionIds,
  onSecondarySessionIdsChange,
  label,
}: Props) {
  const { t } = useTranslation();
  const { data: sessions } = useIgSessions();

  const connected = (sessions ?? []).filter((s) => s.status === "connected");
  if (connected.length === 0) {
    return (
      <EmptyState
        title={t("ig_extract.noSessionsTitle")}
        description={t("ig_extract.noSessionsDesc")}
        icon={Plug}
        action={
          <Button asChild>
            <Link to="/dashboard/instagram/sessions">
              <Plug className="size-4" />
              {t("ig_sessions.import")}
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

  const secondaryOptions = connected.filter((s) => s.id !== primarySessionId);
  const hasMultipleConnected = connected.length > 1;

  return (
    <div className="space-y-4">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--color-fg)]">{label}</label>
          {totalSelected > 1 && (
            <Badge variant="primary" className="gap-1">
              <ShieldCheck className="size-3" />
              {totalSelected} {t("ig_extract.sessionsSelected", { defaultValue: "sessions" })}
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">
          {t("ig_extract.primarySession", { defaultValue: "الجلسة الأساسية (تستخدم للفتح والتمرير)" })}
        </label>
        <Select
          value={primarySessionId}
          onValueChange={handlePrimaryChange}
          options={[
            { value: "", label: t("ig_extract.chooseSession", { defaultValue: "اختر جلسة" }) },
            ...connected.map((s) => ({ value: s.id, label: s.name || s.ig_username || s.id.slice(0, 8) })),
          ]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">
            {t("ig_extract.secondarySessions", { defaultValue: "جلسات إضافية (تبديل تلقائي عند الحظر)" })}
          </label>
          {totalSelected > 1 && (
            <Badge variant="success" className="gap-1 text-[10px]">
              <ShieldCheck className="size-3" />
              +{secondarySessionIds.length} {t("ig_extract.extraActive", { defaultValue: "إضافية" })}
            </Badge>
          )}
        </div>

        {hasMultipleConnected ? (
          <>
            <div className="flex flex-wrap gap-2">
              {secondaryOptions.map((s) => {
                const isSelected = secondarySessionIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSecondary(s.id)}
                    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      isSelected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-muted)]"
                    }`}
                  >
                    {isSelected ? <X className="size-3" /> : <Plus className="size-3" />}
                    <span>{s.name || s.ig_username || s.id.slice(0, 8)}</span>
                  </button>
                );
              })}
            </div>
            {totalSelected > 1 ? (
              <p className="text-xs text-[var(--color-success)] flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" />
                {t("ig_extract.rotationHint", {
                  defaultValue: "سيتم التبديل تلقائياً بين {{count}} جلسات عند حظر إنستجرام لواحدة منها.",
                  count: totalSelected,
                })}
              </p>
            ) : (
              <p className="text-xs text-[var(--color-fg-muted)] flex items-center gap-1.5">
                <Info className="size-3.5 shrink-0" />
                {t("ig_extract.secondaryHint", {
                  defaultValue: "اضغط على جلسة أو أكثر لتفعيل التبديل التلقائي. جلسات أكثر = تغطية استخراج أعلى وحماية من الحظر.",
                })}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-3 space-y-2">
            <p className="text-xs text-[var(--color-fg)] flex items-start gap-1.5">
              <AlertCircle className="size-3.5 shrink-0 text-[var(--color-warning)] mt-0.5" />
              <span>
                {t("ig_extract.needMoreSessions", {
                  defaultValue: "لديك جلسة واحدة فقط. أضف 2-3 جلسات إنستجرام إضافية لرفع نسبة الاستخراج وتفادي حظر الحساب.",
                })}
              </span>
            </p>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/dashboard/instagram/sessions">
                <Plus className="size-3.5" />
                {t("ig_sessions.import")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
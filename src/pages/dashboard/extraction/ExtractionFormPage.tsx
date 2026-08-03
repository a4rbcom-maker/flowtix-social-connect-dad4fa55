import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Database, Link2, Pencil,
  SlidersHorizontal, CheckCircle2, AlertCircle,
  Zap, Clock, Users, RefreshCw, Bell, Save, Copy,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/dropdown";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  getTool, defaultConfig, isValidFacebookUrl,
  type ExtractionConfig, type ExtractionType,
} from "./config";
import { useActiveSessionsForSelect } from "@/hooks/useFbSessions";

function ToggleRow({ icon: Icon, label, desc, checked, onChange }: {
  icon: typeof Zap; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] shrink-0">
        <Icon className="size-4 text-[var(--color-fg-muted)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-fg)]">{label}</p>
        <p className="text-xs text-[var(--color-fg-subtle)]">{desc}</p>
      </div>
      <button onClick={() => onChange(!checked)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform", checked ? "start-5 rtl:start-0.5" : "start-0.5 rtl:start-5")} />
      </button>
    </div>
  );
}

export function ExtractionFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { type } = useParams<{ type: string }>();
  const extractionType = (type as ExtractionType) ?? "group-members";
  const tool = getTool(extractionType);
  const { data: sessionOptions } = useActiveSessionsForSelect();

  const [config, setConfig] = useState<ExtractionConfig>({ ...defaultConfig, type: extractionType });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"form" | "review">("form");
  const [creating, setCreating] = useState(false);

  const ToolIcon = tool?.icon ?? Database;

  function update<K extends keyof ExtractionConfig>(key: K, value: ExtractionConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!config.name.trim()) e.name = t("extraction.errors.nameRequired");
    if (!config.session) e.session = t("extraction.errors.sessionRequired");
    if (!config.url.trim()) e.url = t("extraction.errors.urlRequired");
    else if (!isValidFacebookUrl(config.url)) e.url = t("extraction.errors.urlInvalid");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (validate()) setStep("review");
    else toast({ type: "error", title: t("extraction.errors.checkFields") });
  }

  function handleCreateJob() {
    setCreating(true);
    setTimeout(() => {
      setCreating(false);
      toast({ type: "success", title: t("extraction.jobCreated"), description: config.name });
      navigate("/dashboard/extraction/job/sim-001");
    }, 1500);
  }

  if (step === "review") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <button onClick={() => setStep("form")} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("extraction.backToForm")}
        </button>

        <PageHeader title={t("extraction.review.title")} description={t("extraction.review.subtitle")} icon={CheckCircle2} />

        <Card>
          <CardHeader><CardTitle>{t("extraction.review.summary")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ReviewRow icon={ToolIcon} label={t("extraction.fields.type")} value={t(tool?.titleKey ?? "")} />
            <ReviewRow icon={Database} label={t("extraction.fields.session")} value={sessionOptions?.find(s => s.value === config.session)?.label ?? "—"} />
            <ReviewRow icon={Link2} label={t("extraction.fields.url")} value={config.url} mono />
            <ReviewRow icon={Pencil} label={t("extraction.fields.name")} value={config.name} />

            <div className="border-t border-[var(--color-border)] pt-4">
              <h4 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">{t("extraction.advanced.title")}</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <ReviewChip icon={Copy} label={t("extraction.advanced.skipDuplicates")} value={config.skipDuplicates ? t("common.enabled") : t("common.disabled")} />
                <ReviewChip icon={RefreshCw} label={t("extraction.advanced.retryFailed")} value={config.retryFailed ? t("common.enabled") : t("common.disabled")} />
                <ReviewChip icon={Bell} label={t("extraction.advanced.notifications")} value={config.enableNotifications ? t("common.enabled") : t("common.disabled")} />
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4">
              <h4 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">{t("extraction.review.estimates")}</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]"><Users className="size-3.5" />{t("extraction.review.estimatedResults")}</div>
                  <p className="mt-1 text-lg font-extrabold text-[var(--color-fg)]">{tool?.estimateResults ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]"><Clock className="size-3.5" />{t("extraction.review.estimatedDuration")}</div>
                  <p className="mt-1 text-lg font-extrabold text-[var(--color-fg)]">{tool?.estimateDuration ?? "—"}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setStep("form")}>
            <ArrowLeft className="size-4 rtl:rotate-180" />{t("extraction.back")}
          </Button>
          <Button size="lg" loading={creating} onClick={handleCreateJob}>
            {!creating && <Zap className="size-4" />}
            {t("extraction.createJob")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button onClick={() => navigate("/dashboard/extraction")} className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("extraction.backToTools")}
      </button>

      <PageHeader title={t(tool?.titleKey ?? "")} description={t(tool?.descKey ?? "")} icon={ToolIcon} />

      <Card>
        <CardContent className="space-y-5 pt-6">
          {/* Extraction Name */}
          <div className="space-y-2">
            <Label>{t("extraction.fields.name")} <span className="text-[var(--color-error)]">*</span></Label>
            <InputIcon icon={Pencil} placeholder={t("extraction.fields.namePlaceholder")} value={config.name} onChange={(e) => update("name", e.target.value)} error={!!errors.name} />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </div>

          {/* Session */}
          <div className="space-y-2">
            <Label>{t("extraction.fields.session")} <span className="text-[var(--color-error)]">*</span></Label>
            <Select value={config.session} onValueChange={(v) => update("session", v)} options={[{ value: "", label: t("extraction.fields.sessionPlaceholder") }, ...(sessionOptions ?? [])]} />
            {errors.session && <FieldError>{errors.session}</FieldError>}
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label>{t("extraction.fields.url")} <span className="text-[var(--color-error)]">*</span></Label>
            <InputIcon icon={Link2} type="url" placeholder={t(tool?.urlPlaceholderKey ?? "")} value={config.url} onChange={(e) => update("url", e.target.value)} error={!!errors.url} />
            {errors.url && <FieldError>{errors.url}</FieldError>}
            {config.url && !errors.url && isValidFacebookUrl(config.url) && (
              <p className="flex items-center gap-1.5 text-xs text-[var(--color-success)]"><CheckCircle2 className="size-3.5" />{t("extraction.validUrl")}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>{t("extraction.fields.notes")}</Label>
            <Textarea placeholder={t("extraction.fields.notesPlaceholder")} value={config.notes} onChange={(e) => update("notes", e.target.value)} rows={3} />
          </div>
        </CardContent>
      </Card>

      {/* Advanced Options */}
      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <SlidersHorizontal className="size-5 text-[var(--color-fg-muted)]" />
          <CardTitle>{t("extraction.advanced.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow icon={Copy} label={t("extraction.advanced.skipDuplicates")} desc={t("extraction.advanced.skipDuplicatesDesc")} checked={config.skipDuplicates} onChange={(v) => update("skipDuplicates", v)} />
          <ToggleRow icon={RefreshCw} label={t("extraction.advanced.retryFailed")} desc={t("extraction.advanced.retryFailedDesc")} checked={config.retryFailed} onChange={(v) => update("retryFailed", v)} />
          <ToggleRow icon={Bell} label={t("extraction.advanced.notifications")} desc={t("extraction.advanced.notificationsDesc")} checked={config.enableNotifications} onChange={(v) => update("enableNotifications", v)} />
          <ToggleRow icon={Save} label={t("extraction.advanced.savePreset")} desc={t("extraction.advanced.savePresetDesc")} checked={config.savePreset} onChange={(v) => update("savePreset", v)} />
        </CardContent>
      </Card>

      {/* Validation Summary */}
      {Object.keys(errors).length > 0 && (
        <Alert variant="error">
          <AlertCircle className="size-4" />
          {t("extraction.errors.checkFields")}
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/dashboard/extraction")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />{t("extraction.cancel")}
        </Button>
        <Button size="lg" onClick={handleNext}>
          {t("extraction.review.button")}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ icon: Icon, label, value, mono }: { icon: typeof Zap; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] shrink-0">
        <Icon className="size-4 text-[var(--color-fg-muted)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--color-fg-subtle)]">{label}</p>
        <p className={cn("text-sm font-medium text-[var(--color-fg)] truncate", mono && "font-mono text-xs")}>{value}</p>
      </div>
    </div>
  );
}

function ReviewChip({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] p-2.5">
      <Icon className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
      <span className="text-xs text-[var(--color-fg-subtle)] truncate flex-1">{label}:</span>
      <span className="text-xs font-semibold text-[var(--color-fg)] shrink-0">{value}</span>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-[var(--color-error)]"><AlertCircle className="size-3.5" />{children}</p>;
}

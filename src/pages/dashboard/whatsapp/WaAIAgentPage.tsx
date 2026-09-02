import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot, Zap, MessageSquare, Brain, Sparkles, BookOpen,
  ToggleLeft, ToggleRight, TestTube, Loader2, Settings, ChevronDown,
  User, Briefcase, Building2, Package, GraduationCap, ShieldOff, Save,
  CheckCircle2, Activity, ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/form";
import { LoadingState } from "@/components/ui/state";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { useWaAiConfig, useWaAiMutations, useWaAiInstructions } from "@/hooks/useWaAi";
import { AI_LEVELS } from "@/types/wa-ai.types";
import { useWaAiModels } from "@/hooks/useWaAiModels";
import { AiModel } from "@/lib/wa-ai-models";
import type { AiInstructionItem, AiProviderConfig } from "@/types/wa-ai.types";
import { toast } from "@/components/ui/toast";

type Tab = "levels" | "instruction";

const LEVEL_THEMES: Record<string, { icon: typeof Zap; gradient: string; bg: string; text: string; ring: string; badge: string }> = {
  l1: {
    icon: Zap,
    gradient: "from-emerald-500/20 via-emerald-400/10 to-transparent",
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "ring-emerald-500/30",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  l2: {
    icon: MessageSquare,
    gradient: "from-blue-500/20 via-blue-400/10 to-transparent",
    bg: "bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    ring: "ring-blue-500/30",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  l3: {
    icon: Brain,
    gradient: "from-violet-500/20 via-violet-400/10 to-transparent",
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    ring: "ring-violet-500/30",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
};

export function WaAIAgentPage() {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id || "";

  const [tab, setTab] = useState<Tab>("levels");
  const { data: config, isLoading } = useWaAiConfig();
  const { data: instructions } = useWaAiInstructions();
  const muts = useWaAiMutations();
  const { data: aiModels } = useWaAiModels();

  if (!ws) return <LoadingState className="min-h-[60vh]" />;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("wa.aiAgent.title")} description={t("wa.aiAgent.description")} icon={Bot} />
        <LoadingState className="min-h-[40vh]" />
      </div>
    );
  }

  const isActive = config?.is_active ?? false;

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("wa.aiAgent.title")}
        description={t("wa.aiAgent.description")}
        icon={Bot}
        action={
          config ? <StatusToggle active={isActive} config={config} muts={muts} /> : null
        }
      />

      {/* Premium status banner */}
      <StatusBanner active={isActive} config={config} aiModels={aiModels} />

      {/* Animated tabs */}
      <TabsBar tab={tab} setTab={setTab} t={t} />

      <div className="animate-[fade-up_0.4s_ease-out]">
        {tab === "levels" && <LevelsTab config={config} muts={muts} aiModels={aiModels} />}
        {tab === "instruction" && <InstructionsTab instructions={instructions ?? []} muts={muts} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Status Toggle (premium switch)
// ═══════════════════════════════════════════════════════════

function StatusToggle({
  active,
  config,
  muts,
}: {
  active: boolean;
  config: AiProviderConfig;
  muts: ReturnType<typeof useWaAiMutations>;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={() => {
        muts.saveConfig.mutate(
          {
            baseUrl: config.base_url,
            models: config.models as any,
            settings: config.settings,
            costCaps: config.cost_caps,
            isActive: !active,
          },
          {
            onSuccess: () =>
              toast({
                type: "success",
                title: active ? t("wa.aiAgent.disabled") : t("wa.aiAgent.enabled"),
              }),
          },
        );
      }}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-full border px-3 py-2 text-xs font-semibold transition-all duration-300",
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shadow-[0_4px_16px_-4px_rgba(16,185,129,0.4)]"
          : "border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
      )}
      aria-pressed={active}
    >
      <span
        className={cn(
          "relative flex size-5 items-center justify-center rounded-full transition-all duration-300",
          active ? "bg-emerald-500" : "bg-[var(--color-border-strong)]",
        )}
      >
        <span
          className={cn(
            "absolute size-3 rounded-full bg-white shadow-sm transition-transform duration-300",
            active ? "translate-x-1" : "-translate-x-1",
          )}
        />
      </span>
      <span className="flex items-center gap-1.5">
        {active ? <ToggleRight className="size-3.5" /> : <ToggleLeft className="size-3.5" />}
        {active ? t("wa.aiAgent.enabled") : t("wa.aiAgent.disabled")}
      </span>
      {active && (
        <span className="absolute inset-0 -z-10 animate-[pulse-glow_2.5s_ease-in-out_infinite] rounded-full" />
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// Status Banner
// ═══════════════════════════════════════════════════════════

function StatusBanner({
  active,
  config: _config,
  aiModels,
}: {
  active: boolean;
  config: AiProviderConfig | null | undefined;
  aiModels: AiModel[] | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-500",
        active
          ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] via-[var(--color-surface)] to-[var(--color-surface)]"
          : "border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface-2)] via-[var(--color-surface)] to-[var(--color-surface)]",
      )}
    >
      <div className="absolute inset-0 bg-grid opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl transition-all duration-500",
              active
                ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)]"
                : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
            )}
          >
            {active ? <Sparkles className="size-6 animate-[pulse-glow_2s_ease-in-out_infinite]" /> : <Bot className="size-6" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[var(--color-fg)] sm:text-lg">
                {active ? t("wa.aiAgent.enabled") : t("wa.aiAgent.disabled")}
              </h2>
              {active && (
                <Badge variant="success" className="gap-1">
                  <span className="relative flex size-1.5">
                    <span className="absolute inset-0 animate-[pulse-glow_2s_ease-in-out_infinite] rounded-full bg-emerald-500" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
              {active
                ? t("wa.aiAgent.description")
                : t("wa.aiAgent.description")}
            </p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 sm:gap-6">
          <Stat icon={Activity} label="Levels" value={3} />
          <Stat icon={Sparkles} label="Models" value={aiModels?.length ?? 0} />
          <Stat icon={CheckCircle2} label="Status" value={active ? "ON" : "OFF"} highlight={active} />
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Sparkles;
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          highlight
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="hidden sm:block">
        <p className="text-xs text-[var(--color-fg-muted)]">{label}</p>
        <p
          className={cn(
            "text-sm font-bold leading-tight",
            highlight ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--color-fg)]",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Animated Tabs
// ═══════════════════════════════════════════════════════════

function TabsBar({
  tab,
  setTab,
  t,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  t: (k: string) => string;
}) {
  const tabs: Array<{ key: Tab; icon: typeof Bot; label: string }> = [
    { key: "levels", icon: Sparkles, label: t("wa.aiAgent.levels") },
    { key: "instruction", icon: BookOpen, label: t("wa.aiAgent.instructions") },
  ];

  return (
    <div className="relative inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-sm)]">
      {tabs.map((tbi) => {
        const isActive = tab === tbi.key;
        return (
          <button
            key={tbi.key}
            onClick={() => setTab(tbi.key)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-300",
              isActive
                ? "bg-gradient-brand text-white shadow-[0_4px_16px_-4px_rgba(109,94,252,0.5)] [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            )}
            aria-pressed={isActive}
          >
            <tbi.icon className={cn("size-4 transition-transform duration-300", isActive && "scale-110")} />
            <span>{tbi.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tab 1: Levels
// ═══════════════════════════════════════════════════════════

function LevelsTab({
  config,
  muts,
  aiModels,
}: {
  config: AiProviderConfig | null | undefined;
  muts: ReturnType<typeof useWaAiMutations>;
  aiModels: AiModel[] | undefined;
}) {
  const { t, i18n } = useTranslation();
  const locale: "en" | "ar" = i18n.language === "ar" ? "ar" : "en";

  const [l1Model, setL1] = useState(AI_LEVELS[0].defaultModel);
  const [l2Model, setL2] = useState(AI_LEVELS[1].defaultModel);
  const [l3Model, setL3] = useState(AI_LEVELS[2].defaultModel);
  const [temp1, setTemp1] = useState(AI_LEVELS[0].defaultTemp);
  const [temp2, setTemp2] = useState(AI_LEVELS[1].defaultTemp);
  const [temp3, setTemp3] = useState(AI_LEVELS[2].defaultTemp);
  const [showSettings, setShowSettings] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!config) return;
    const m = config.models as any;
    setL1(m?.l1 ?? AI_LEVELS[0].defaultModel);
    setL2(m?.l2 ?? AI_LEVELS[1].defaultModel);
    setL3(m?.l3 ?? AI_LEVELS[2].defaultModel);
    const s = config.settings as any;
    setTemp1(s?.l1_temperature ?? AI_LEVELS[0].defaultTemp);
    setTemp2(s?.l2_temperature ?? AI_LEVELS[1].defaultTemp);
    setTemp3(s?.l3_temperature ?? AI_LEVELS[2].defaultTemp);
  }, [config]);

  const handleSave = () => {
    muts.saveConfig.mutate(
      {
        baseUrl: config?.base_url ?? "",
        models: { l1: l1Model, l2: l2Model, l3: l3Model },
        settings: {
          l1_temperature: temp1,
          l2_temperature: temp2,
          l3_temperature: temp3,
        },
        costCaps: config?.cost_caps,
        isActive: config?.is_active ?? true,
      },
      {
        onSuccess: () => toast({ type: "success", title: t("wa.aiAgent.saved") }),
      },
    );
  };

  const handleTest = () => {
    muts.testConfig.mutate(undefined, {
      onSuccess: (r: any) =>
        toast({
          type: r.success ? "success" : "error",
          title:
            r?.message ??
            (r.success ? t("wa.aiAgent.testSuccess") : t("wa.aiAgent.testFailed")),
        }),
    } as any);
  };

  const modelOptions = useMemo(() => {
    return (aiModels ?? []).map((m) => ({
      value: m.model_id,
      label: `${m.display_name[locale] ?? m.model_id} — ${m.description[locale] ?? ""}`,
    }));
  }, [aiModels, locale]);

  return (
    <div className="space-y-6">
      {/* Section title */}
      <SectionHeader
        icon={Sparkles}
        title={t("wa.aiAgent.levels")}
        description="Configure each level's model and creativity"
      />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {AI_LEVELS.map((level, idx) => {
          const theme = LEVEL_THEMES[level.id];
          const Icon = theme.icon;
          const modelState = level.id === "l1" ? l1Model : level.id === "l2" ? l2Model : l3Model;
          const setModel = level.id === "l1" ? setL1 : level.id === "l2" ? setL2 : setL3;
          const tempState = level.id === "l1" ? temp1 : level.id === "l2" ? temp2 : temp3;
          const setTemp = level.id === "l1" ? setTemp1 : level.id === "l2" ? setTemp2 : setTemp3;
          const expanded = showSettings[level.id] ?? false;

          return (
            <Card
              key={level.id}
              className={cn(
                "card-hover group relative overflow-hidden border-[var(--color-border)]",
              )}
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              {/* Gradient overlay */}
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity duration-500 group-hover:opacity-100",
                  theme.gradient,
                )}
              />

              <CardContent className="relative space-y-4 p-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3",
                        theme.bg,
                        theme.text,
                      )}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[var(--color-fg)]">{level.label[locale]}</h3>
                      <p className="mt-0.5 text-xs text-[var(--color-fg-muted)] line-clamp-2">
                        {level.desc[locale]}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Intents */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
                    {t("wa.aiAgent.intents")}
                  </span>
                  {level.intents.map((int) => (
                    <span
                      key={int}
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        theme.badge,
                      )}
                    >
                      {int}
                    </span>
                  ))}
                </div>

                {/* Model selector */}
                <div>
                  <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                    <Sparkles className="size-3" />
                    {t("wa.aiAgent.model")}
                  </Label>
                  <ModelSelect
                    value={modelState}
                    onChange={setModel}
                    options={modelOptions}
                    accent={theme.text}
                  />
                </div>

                {/* Advanced settings toggle */}
                <button
                  onClick={() => setShowSettings({ ...showSettings, [level.id]: !expanded })}
                  className={cn(
                    "group/btn flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-semibold transition-all duration-200 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-3)]",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[var(--color-fg-muted)] group-hover/btn:text-[var(--color-fg)]">
                    <Settings className="size-3.5" />
                    {t("wa.aiAgent.advanced")}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 text-[var(--color-fg-muted)] transition-transform duration-300",
                      expanded && "rotate-180",
                    )}
                  />
                </button>

                {expanded && (
                  <div className="animate-[fade-up_0.3s_ease-out] space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label className="text-xs font-semibold">
                          {t("wa.aiAgent.temperature")}
                        </Label>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 font-mono text-xs font-bold",
                            theme.bg,
                            theme.text,
                          )}
                        >
                          {tempState.toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={tempState}
                        onChange={(e) => setTemp(parseFloat(e.target.value))}
                        className="w-full cursor-pointer accent-[var(--color-primary)]"
                      />
                      <div className="mt-1 flex justify-between text-[10px] font-medium text-[var(--color-fg-subtle)]">
                        <span>0 — {t("wa.aiAgent.precise")}</span>
                        <span>1 — {t("wa.aiAgent.creative")}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--color-fg)]">
            {t("wa.aiAgent.save")}
          </p>
          <p className="text-xs text-[var(--color-fg-muted)]">
            Save your model and temperature settings
          </p>
        </div>
        <Button variant="outline" onClick={handleTest} loading={muts.testConfig.isPending as boolean} className="gap-2">
          {muts.testConfig.isPending ? <Loader2 className="size-4 animate-spin" /> : <TestTube className="size-4" />}
          {t("wa.aiAgent.testConnection")}
        </Button>
        <Button variant="primary" onClick={handleSave} loading={muts.saveConfig.isPending} className="gap-2">
          {muts.saveConfig.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("wa.aiAgent.save")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Custom Model Select (better visual)
// ═══════════════════════════════════════════════════════════

function ModelSelect({
  value,
  onChange,
  options,
  accent,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  accent: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3 pe-9 text-sm font-medium text-[var(--color-fg)] transition-all duration-200",
          "hover:border-[var(--color-primary)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]",
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-muted)]",
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute end-9 top-1/2 size-2 -translate-y-1/2 rounded-full",
          accent.replace("text-", "bg-").split(" ")[0],
        )}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Section Header
// ═══════════════════════════════════════════════════════════

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Sparkles;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary)]">
        <Icon className="size-4" />
      </div>
      <div>
        <h2 className="text-base font-bold text-[var(--color-fg)]">{title}</h2>
        {description && <p className="text-xs text-[var(--color-fg-muted)]">{description}</p>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tab 2: Instructions
// ═══════════════════════════════════════════════════════════

function InstructionsTab({
  instructions,
  muts,
}: {
  instructions: AiInstructionItem[];
  muts: ReturnType<typeof useWaAiMutations>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [services, setServices] = useState("");
  const [trainingInstructions, setTrainingInstructions] = useState("");
  const [blockedTopics, setBlockedTopics] = useState("");

  const latest = instructions[0];

  useEffect(() => {
    if (!latest) return;
    const fields = parseInstructions(latest.instructions);
    setName(fields.name);
    setRole(fields.role);
    setCompany(fields.company);
    setServices(fields.services);
    setTrainingInstructions(fields.training);
    setBlockedTopics(fields.blocked);
  }, [latest?.id]);

  const handleSave = () => {
    const combinedInstructions = `اسم الوكيل: ${name}
وظيفة: ${role}
الشركة: ${company}
الخدمات:
${services}
تعليمات التدريب:
${trainingInstructions}
المواضيع المحظورة:
${blockedTopics}`;

    muts.saveInstructions.mutate(
      {
        workspaceId: latest?.workspace_id ?? "",
        id: latest?.id,
        instructions: combinedInstructions,
        is_active: true,
      },
      {
        onSuccess: () =>
          toast({
            type: "success",
            title: t("wa.aiAgent.instructionsUpdated"),
          }),
      },
    );
  };

  const handleReset = () => {
    setName("");
    setRole("");
    setCompany("");
    setServices("");
    setTrainingInstructions("");
    setBlockedTopics("");
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={BookOpen}
        title={t("wa.aiAgent.instructions")}
        description="Define your agent's identity, services, and boundaries"
      />

      {/* Identity section */}
      <InstructionCard
        icon={User}
        title={t("wa.aiAgent.agentName")}
        gradient="from-blue-500/10 to-transparent"
        iconBg="bg-blue-500/15 text-blue-600 dark:text-blue-400"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("wa.aiAgent.agentName")}
            icon={User}
            placeholder={t("wa.aiAgent.agentNamePlaceholder")}
            value={name}
            onChange={setName}
          />
          <Field
            label={t("wa.aiAgent.agentRole")}
            icon={Briefcase}
            placeholder={t("wa.aiAgent.agentRolePlaceholder")}
            value={role}
            onChange={setRole}
          />
        </div>
      </InstructionCard>

      {/* Company section */}
      <InstructionCard
        icon={Building2}
        title={t("wa.aiAgent.agentCompany")}
        gradient="from-violet-500/10 to-transparent"
        iconBg="bg-violet-500/15 text-violet-600 dark:text-violet-400"
      >
        <Field
          label={t("wa.aiAgent.agentCompany")}
          icon={Building2}
          placeholder={t("wa.aiAgent.agentCompanyPlaceholder")}
          value={company}
          onChange={setCompany}
        />
      </InstructionCard>

      {/* Services section */}
      <InstructionCard
        icon={Package}
        title={t("wa.aiAgent.agentServices")}
        gradient="from-emerald-500/10 to-transparent"
        iconBg="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      >
        <TextAreaField
          label={t("wa.aiAgent.agentServices")}
          placeholder={t("wa.aiAgent.agentServicesPlaceholder")}
          value={services}
          onChange={setServices}
          rows={4}
        />
      </InstructionCard>

      {/* Training section */}
      <InstructionCard
        icon={GraduationCap}
        title={t("wa.aiAgent.trainingInstructions")}
        gradient="from-amber-500/10 to-transparent"
        iconBg="bg-amber-500/15 text-amber-600 dark:text-amber-400"
      >
        <TextAreaField
          label={t("wa.aiAgent.trainingInstructions")}
          placeholder={t("wa.aiAgent.trainingInstructionsPlaceholder")}
          value={trainingInstructions}
          onChange={setTrainingInstructions}
          rows={5}
        />
      </InstructionCard>

      {/* Blocked topics section */}
      <InstructionCard
        icon={ShieldOff}
        title={t("wa.aiAgent.blockedTopics")}
        gradient="from-rose-500/10 to-transparent"
        iconBg="bg-rose-500/15 text-rose-600 dark:text-rose-400"
      >
        <TextAreaField
          label={t("wa.aiAgent.blockedTopics")}
          placeholder={t("wa.aiAgent.blockedTopicsPlaceholder")}
          value={blockedTopics}
          onChange={setBlockedTopics}
          rows={4}
        />
      </InstructionCard>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-[var(--color-fg)]">
            {latest ? t("wa.aiAgent.instructionsUpdated") : t("wa.aiAgent.instructionsCreated")}
          </p>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {latest ? "Last updated instructions" : "Create your first agent instructions"}
          </p>
        </div>
        <Button variant="outline" onClick={handleReset} disabled={!name && !role && !company && !services && !trainingInstructions && !blockedTopics}>
          Reset
        </Button>
        <Button variant="primary" onClick={handleSave} loading={muts.saveInstructions.isPending} className="gap-2">
          {muts.saveInstructions.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("wa.aiAgent.save")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Instruction Card (reusable visual section)
// ═══════════════════════════════════════════════════════════

function InstructionCard({
  icon: Icon,
  title,
  gradient,
  iconBg,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  gradient: string;
  iconBg: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="card-hover relative overflow-hidden">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-50", gradient)} />
      <CardContent className="relative space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", iconBg)}>
            <Icon className="size-5" />
          </div>
          <h3 className="font-bold text-[var(--color-fg)]">{title}</h3>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Field (input with icon)
// ═══════════════════════════════════════════════════════════

function Field({
  label,
  icon: Icon,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  icon: typeof User;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="size-3.5" />
        {label}
      </Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="ps-10"
        />
      </div>
    </div>
  );
}

function TextAreaField({
  label,
  placeholder,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <Label className="mb-1.5 text-xs font-semibold">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="min-h-0 resize-y transition-colors focus:border-[var(--color-primary)]"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Helper: parse instructions blob
// ═══════════════════════════════════════════════════════════

function parseInstructions(blob: string) {
  const out = { name: "", role: "", company: "", services: "", training: "", blocked: "" };
  if (!blob) return out;
  const sections = blob.split(/\n(?=اسم الوكيل|وظيفة|الشركة|الخدمات|تعليمات التدريب|المواضيع المحظورة)/);
  for (const s of sections) {
    if (s.startsWith("اسم الوكيل:")) out.name = s.replace("اسم الوكيل:", "").trim();
    else if (s.startsWith("وظيفة:")) out.role = s.replace("وظيفة:", "").trim();
    else if (s.startsWith("الشركة:")) out.company = s.replace("الشركة:", "").trim();
    else if (s.startsWith("الخدمات:")) out.services = s.replace("الخدمات:", "").trim();
    else if (s.startsWith("تعليمات التدريب:")) out.training = s.replace("تعليمات التدريب:", "").trim();
    else if (s.startsWith("المواضيع المحظورة:")) out.blocked = s.replace("المواضيع المحظورة:", "").trim();
  }
  return out;
}
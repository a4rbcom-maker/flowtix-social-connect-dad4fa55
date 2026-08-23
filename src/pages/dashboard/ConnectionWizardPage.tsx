import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Plug, Cookie, CheckCircle2, Loader2, Wifi, ShieldCheck,
  ArrowRight, ArrowLeft, AlertTriangle, Eye, Pencil,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InputIcon } from "@/components/ui/input-icon";
import { Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { validateFbCookiesDetailed, parseCookieStringDetailed, type CookieFormat } from "@/lib/cookie-parser";
import {
  useSessionMutations,
  useSessionStats,
  SessionValidationError,
} from "@/hooks/useFbSessions";
import { MAX_SESSIONS_PER_USER } from "@/lib/fb-sessions";

type WizardStep = 1 | 2 | 3 | 4;
type ConnectionState = "connecting" | "success" | "failed";

export function ConnectionWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(1);
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [sessionName, setSessionName] = useState("");
  const [cookieString, setCookieString] = useState("");
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const mutations = useSessionMutations();
  const { data: stats } = useSessionStats();

  const atLimit = (stats?.total ?? 0) >= MAX_SESSIONS_PER_USER;

  const cookieValidation = cookieString ? validateFbCookiesDetailed(cookieString) : null;
  const cookieResult = cookieString ? parseCookieStringDetailed(cookieString) : null;

  const FORMAT_LABELS: Record<CookieFormat, string> = {
    json: "Cookie-Editor (JSON)",
    netscape: "Netscape Cookie File",
    header: "Header String",
    "line-per-cookie": "Line per Cookie",
    unknown: "",
  };

  const steps = [
    { num: 1, label: t("wizard.steps.name"), icon: Pencil },
    { num: 2, label: t("wizard.steps.cookies"), icon: Cookie },
    { num: 3, label: t("wizard.steps.connecting"), icon: Wifi },
    { num: 4, label: t("wizard.steps.finish"), icon: CheckCircle2 },
  ];

  function handleConnect() {
    if (!sessionName.trim()) {
      toast({ type: "error", title: t("sessions.add.sessionName") });
      return;
    }
    if (!cookieValidation?.valid) {
      toast({ type: "error", title: t("wizard.cookies.invalid"), description: t("wizard.cookies.missingKeys") });
      return;
    }

    mutations.create.mutate(
      { name: sessionName.trim(), browser: "Chrome", connectionMethod: "cookie", cookies: cookieString },
      {
        onSuccess: (result) => {
          setCreatedSessionId(result.session.id);
          setStep(3);
        },
        onError: (err) => {
          if (err instanceof SessionValidationError) {
            toast({ type: "error", title: t("common.validationError"), description: err.message });
          } else {
            toast({ type: "error", title: t("common.error"), description: err.message });
          }
        },
      },
    );
  }

  useEffect(() => {
    if (step === 3 && createdSessionId) {
      setConnState("connecting");
      mutations.connect.mutate(createdSessionId, {
        onSuccess: () => {
          setConnState("success");
          setTimeout(() => setStep(4), 800);
        },
        onError: () => {
          setConnState("failed");
        },
      });
    }
  }, [step, createdSessionId]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-between max-w-sm mx-auto">
        {steps.map((s, idx) => {
          const StepIcon = s.icon;
          return (
            <div key={s.num} className="flex items-center">
              <div className={cn(
                "flex size-8 sm:size-9 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                step > s.num ? "bg-[var(--color-success)] text-white" :
                step === s.num ? "gradient-brand text-white scale-110 shadow-[var(--shadow-md)]" :
                "bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]"
              )}>
                {step > s.num ? <CheckCircle2 className="size-3.5 sm:size-4" /> : <StepIcon className="size-3.5 sm:size-4" />}
              </div>
              {idx < steps.length - 1 && (
                <div className={cn("mx-0.5 sm:mx-1 h-0.5 w-4 sm:w-10 rounded-full transition-all duration-300", step > s.num ? "bg-[var(--color-success)]" : "bg-[var(--color-surface-3)]")} />
              )}
            </div>
          );
        })}
      </div>

      <Card>
        <CardContent className="min-h-[320px] p-6 sm:p-8">

          {/* Step 1: Session Name */}
          {step === 1 && (
            <div className="flex flex-col items-center gap-5 text-center animate-[fade-in_0.4s_ease-out]">
              <div className="flex size-16 items-center justify-center rounded-2xl gradient-brand text-white shadow-[var(--shadow-lg)]">
                <Plug className="size-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-extrabold text-[var(--color-fg)]">{t("wizard.nameStep.title")}</h2>
                <p className="max-w-md text-sm text-[var(--color-fg-muted)]">{t("wizard.nameStep.description")}</p>
              </div>

              {atLimit ? (
                <div className="flex items-start gap-3 rounded-xl border border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] p-4 w-full max-w-sm text-start">
                  <AlertTriangle className="size-5 text-[var(--color-warning)] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[var(--color-fg)]">{t("sessions.limitReached")}</p>
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      <Link to="/dashboard/facebook/sessions" className="text-[var(--color-primary)] hover:underline">{t("sessions.title")}</Link>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-sm space-y-2">
                  <label className="text-start text-sm font-medium text-[var(--color-fg)]">{t("sessions.add.sessionName")}</label>
                  <InputIcon icon={Pencil} placeholder={t("wizard.nameStep.placeholder")} value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
                </div>
              )}

              <div className="grid w-full gap-3 sm:grid-cols-3">
                {[
                  { icon: ShieldCheck, label: t("wizard.nameStep.secure"), color: "text-[var(--color-success)]" },
                  { icon: Wifi, label: t("wizard.nameStep.fast"), color: "text-[var(--color-primary)]" },
                  { icon: Cookie, label: t("wizard.nameStep.cookieMethod"), color: "text-[var(--color-warning)]" },
                ].map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.label} className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-border)] p-3">
                      <Icon className={cn("size-5", f.color)} />
                      <span className="text-xs font-medium text-[var(--color-fg)]">{f.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2: Cookie Input */}
          {step === 2 && (
            <div className="space-y-5 animate-[fade-in_0.4s_ease-out]">
              <div className="text-center">
                <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)]">
                  <Cookie className="size-7 text-[var(--color-warning)]" />
                </div>
                <h2 className="text-xl font-extrabold text-[var(--color-fg)]">{t("wizard.cookies.title")}</h2>
                <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t("wizard.cookies.description")}</p>
              </div>

              {/* Cookie-Editor Badge */}
              <div className="flex items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--color-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-info)_6%,transparent)] p-3">
                <Puzzle className="size-5 text-[var(--color-primary)] shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-fg)]">{t("extract.cookieEditorBadge")}</p>
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("extract.cookieEditorBadgeDesc")}</p>
                </div>
              </div>

              {/* How to get cookies */}
              <Card className="border-[color-mix(in_oklab,var(--color-info)_30%,transparent)]">
                <CardHeader className="flex-row items-center gap-2 p-4">
                  <Puzzle className="size-5 text-[var(--color-primary)]" />
                  <CardTitle className="text-sm">{t("wizard.cookies.howToGet")}</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="relative space-y-3 ps-5">
                    <div className="absolute start-[11px] top-2 bottom-2 w-0.5 bg-[var(--color-border)]" />
                    {[
                      { step: t("wizard.cookies.step1"), desc: t("wizard.cookies.step1Desc") },
                      { step: t("wizard.cookies.step2"), desc: t("wizard.cookies.step2Desc") },
                      { step: t("wizard.cookies.step3"), desc: t("wizard.cookies.step3Desc") },
                      { step: t("wizard.cookies.step4"), desc: t("wizard.cookies.step4Desc") },
                    ].map((s, i) => (
                      <div key={i} className="relative flex gap-3">
                        <div className="z-10 flex size-5 shrink-0 items-center justify-center rounded-full gradient-brand text-[0.55rem] font-bold text-white -ms-5">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[var(--color-fg)]">{s.step}</p>
                          <p className="text-xs text-[var(--color-fg-muted)]">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Cookie textarea */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--color-fg)]">{t("wizard.cookies.pasteHere")}</label>
                <Textarea
                  className="min-h-[120px] w-full font-mono text-xs"
                  placeholder={t("extract.cookiesPlaceholderNew")}
                  value={cookieString}
                  onChange={(e) => setCookieString(e.target.value)}
                />
              </div>

              {/* Detected format */}
              {cookieResult && cookieResult.format !== "unknown" && (
                <div className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                  <Eye className="size-3.5" />
                  <span>{t("extract.cookieFormatDetected")}: <span className="font-semibold text-[var(--color-fg)]">{FORMAT_LABELS[cookieResult.format]}</span></span>
                </div>
              )}

              {/* Validation feedback */}
              {cookieValidation && (
                <div className={cn(
                  "rounded-xl border p-3",
                  cookieValidation.valid
                    ? "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_8%,transparent)]"
                    : "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)]"
                )}>
                  <div className="flex items-start gap-2">
                    {cookieValidation.valid
                      ? <CheckCircle2 className="size-5 text-[var(--color-success)] shrink-0" />
                      : <AlertTriangle className="size-5 text-[var(--color-warning)] shrink-0" />
                    }
                    <div className="text-sm">
                      <p className={cookieValidation.valid ? "font-semibold text-[var(--color-success)]" : "font-semibold text-[var(--color-warning)]"}>
                        {cookieValidation.valid ? t("wizard.cookies.valid") : t("wizard.cookies.partial")}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {cookieValidation.found.map((k) => (
                          <Badge key={k} variant="success" className="text-xs">{k}</Badge>
                        ))}
                        {cookieValidation.missing.map((k) => (
                          <Badge key={k} variant="warning" className="text-xs">{k}?</Badge>
                        ))}
                      </div>
                      {!cookieValidation.valid && (
                        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">{t("wizard.cookies.needEssential")}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Connection Status */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center gap-6 py-8 text-center animate-[fade-in_0.4s_ease-out]">
              {connState === "connecting" && (
                <>
                  <div className="relative flex size-24 items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] animate-[ping_2s_ease-in-out_infinite]" />
                    <div className="absolute inset-2 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_25%,transparent)] animate-[ping_2s_ease-in-out_infinite_0.5s]" />
                    <Loader2 className="size-12 animate-spin text-[var(--color-primary)]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-[var(--color-fg)]">{t("wizard.connecting.title")}</h2>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t("wizard.connecting.description")}</p>
                  </div>
                </>
              )}
              {connState === "success" && (
                <>
                  <div className="flex size-24 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)] animate-[scale-in_0.3s_ease-out]">
                    <CheckCircle2 className="size-12 text-[var(--color-success)]" />
                  </div>
                  <h2 className="text-xl font-extrabold text-[var(--color-success)]">{t("wizard.connecting.success")}</h2>
                </>
              )}
              {connState === "failed" && (
                <>
                  <div className="flex size-24 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)]">
                    <AlertTriangle className="size-12 text-[var(--color-error)]" />
                  </div>
                  <h2 className="text-xl font-extrabold text-[var(--color-error)]">{t("wizard.connecting.failed")}</h2>
                  <Button variant="secondary" onClick={() => { setStep(2); setConnState("connecting"); }}>
                    {t("wizard.back")}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Step 4: Finish */}
          {step === 4 && (
            <div className="flex flex-col items-center gap-5 text-center animate-[scale-in_0.4s_ease-out]">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]">
                <CheckCircle2 className="size-10 text-[var(--color-success)]" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-[var(--color-fg)]">{t("wizard.finish.title")}</h2>
                <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t("wizard.finish.description")}</p>
              </div>
              <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 space-y-2 text-sm text-start">
                <div className="flex justify-between"><span className="text-[var(--color-fg-subtle)]">{t("wizard.finish.sessionName")}</span><span className="font-semibold text-[var(--color-fg)]">{sessionName}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-fg-subtle)]">{t("wizard.finish.method")}</span><span className="font-semibold text-[var(--color-fg)]">{t("wizard.cookies.title")}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-fg-subtle)]">{t("wizard.finish.status")}</span><Badge variant="success">{t("sessions.status.connected")}</Badge></div>
                <div className="flex justify-between"><span className="text-[var(--color-fg-subtle)]">{t("wizard.finish.connectedAt")}</span><span className="font-semibold text-[var(--color-fg)]">{new Date().toLocaleString()}</span></div>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Button variant="primary" size="lg" onClick={() => navigate("/dashboard/facebook/extract-members")} className="gap-2">
                  <ArrowRight className="size-4 rtl:rotate-180" />{t("wizard.finish.startExtraction")}
                </Button>
                {createdSessionId && (
                  <Button variant="secondary" size="lg" onClick={() => navigate("/dashboard/facebook/sessions")} className="gap-2">
                    <Plug className="size-4" />{t("sessions.title")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      {step < 4 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => step > 1 ? setStep((step - 1) as WizardStep) : navigate(-1)}>
            <ArrowLeft className="size-4 rtl:rotate-180" />{step > 1 ? t("wizard.back") : t("common.cancel")}
          </Button>
          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!sessionName.trim() || atLimit}>
              {t("wizard.next")}<ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={handleConnect} disabled={!cookieValidation?.valid || mutations.create.isPending || atLimit}>
              {mutations.create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
              {t("wizard.cookies.connect")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

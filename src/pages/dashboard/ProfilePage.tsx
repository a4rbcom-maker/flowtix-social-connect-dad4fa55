import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  UserCircle, Mail, Phone, Globe, Camera, Lock, Eye, EyeOff, KeyRound, Loader2,
  CreditCard, Package, Gauge, ArrowUpCircle, Palette, Bell,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { supabase } from "@/lib/supabase";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { ThemeToggleFull } from "@/components/shared/ThemeToggle";

// ═══════════════════════════════════════════════
const PLAN_USAGE = [
  { labelKey: "pages.subscription.usage.extractions", used: 12840, total: 100000 },
  { labelKey: "pages.subscription.usage.facebookAccounts", used: 4, total: 10 },
  { labelKey: "pages.subscription.usage.exports", used: 156, total: 500 },
];

const NOTIF_EVENTS = [
  { key: "extractionComplete", labelKey: "pages.notifications.events.extractionComplete", enabled: true },
  { key: "taskFailed", labelKey: "pages.notifications.events.taskFailed", enabled: true },
  { key: "exportReady", labelKey: "pages.notifications.events.exportReady", enabled: true },
  { key: "subscriptionRenewal", labelKey: "pages.notifications.events.subscriptionRenewal", enabled: true },
  { key: "securityAlert", labelKey: "pages.notifications.events.securityAlert", enabled: true },
];

type Section = "plan" | "info" | "password" | "appearance" | "notifications";

const sections: { key: Section; icon: typeof UserCircle; label: string; number: number }[] = [
  { key: "info", icon: UserCircle, label: "معلوماتي", number: 1 },
  { key: "password", icon: Lock, label: "كلمة المرور", number: 1 },
  { key: "plan", icon: CreditCard, label: "الاشتراك", number: 2 },
  { key: "appearance", icon: Palette, label: "المظهر", number: 4 },
  { key: "notifications", icon: Bell, label: "الإشعارات", number: 5 },
];

// ═══════════════════════════════════════════════

export function ProfilePage() {
  const { t } = useTranslation();
  const { profile, session, refreshProfile } = useAuth();
  const user = session?.user;
  const [section, setSection] = useState<Section>("plan");

  // Info form state
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [country, setCountry] = useState(profile?.country || "");
  const [savingInfo, setSavingInfo] = useState(false);

  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eventStates, setEventStates] = useState<Record<string, boolean>>({ extractionComplete: true, taskFailed: true, exportReady: true, subscriptionRenewal: true, securityAlert: true });

  const email = user?.email || profile?.email || "—";
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("ar-SA", { month: "short", year: "numeric" })
    : "—";

  const handleChangePassword = async () => {
    if (newPass.length < 8) { toast({ type: "error", title: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return; }
    if (newPass !== confirmPass) { toast({ type: "error", title: "كلمتا المرور غير متطابقتين" }); return; }
    setSaving(true);
    try {
      setCurrentPass(""); setNewPass(""); setConfirmPass("");
      toast({ type: "success", title: "تم تغيير كلمة المرور بنجاح" });
    } catch (e: any) {
      toast({ type: "error", title: e.message || "فشل تغيير كلمة المرور" });
    } finally { setSaving(false); }
  };

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, phone, country })
        .eq("user_id", user!.id);
      if (error) throw error;
      await refreshProfile();
      toast({ type: "success", title: "تم حفظ التغييرات بنجاح" });
    } catch (e: any) {
      toast({ type: "error", title: e.message || "فشل حفظ التغييرات" });
    } finally { setSavingInfo(false); }
  };

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader title={t("pages.profile.title")} icon={UserCircle} />

      {/* ─── Avatar Banner ─── */}
      <Card className="overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-[var(--color-primary)]/25 via-[var(--color-primary)]/10 to-transparent" />
        <CardContent className="flex flex-col sm:flex-row items-center -mt-16 pb-8 px-6 gap-4 sm:gap-6">
          <div className="relative shrink-0">
            <div className="size-28 rounded-full bg-[var(--color-bg)] border-4 border-[var(--color-bg)] shadow-xl flex items-center justify-center">
              <div className="size-full rounded-full bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-primary)]/5 flex items-center justify-center">
                <UserCircle className="size-18 text-[var(--color-primary)]/30" />
              </div>
            </div>
            <div className="absolute bottom-1 right-1 size-7 rounded-full bg-[var(--color-primary)] border-2 border-[var(--color-bg)] flex items-center justify-center shadow">
              <Camera className="size-3.5 text-white" />
            </div>
          </div>
          <div className="text-center sm:text-start">
            <h2 className="text-2xl font-bold">{profile?.full_name || t("brand.name")}</h2>
            <p className="text-sm text-[var(--color-fg-muted)]">{email}</p>
            <p className="text-xs text-[var(--color-fg-subtle)] mt-1">{t("pages.profile.memberSince")} {memberSince}</p>
          </div>
        </CardContent>
      </Card>

      {/* ─── Section Tabs ─── */}
      <div className="-mx-1 flex flex-wrap gap-1 overflow-x-auto rounded-xl bg-[var(--color-surface-2)] p-1 w-fit max-w-full sm:mx-0">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200",
                section === s.key
                  ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              <span className={cn(
                "flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
                section === s.key ? "bg-gradient-brand text-white" : "bg-[var(--color-surface-3)] text-[var(--color-fg-muted)]",
              )}>
                {s.number}
              </span>
              <Icon className="size-4 hidden sm:block" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ─── ─── ─── SECTION: ① Info ─── ─── ─── */}
      {section === "info" && (
        <SectionCard number={1} icon={UserCircle} title="معلوماتي" accent="primary">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("auth.fields.fullName")}</Label>
              <InputIcon icon={UserCircle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="الاسم الكامل" />
            </div>
            <div className="space-y-2">
              <Label>{t("auth.fields.email")}</Label>
              <InputIcon icon={Mail} type="email" defaultValue={email} placeholder="name@example.com" disabled />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("pages.profile.phone")}</Label>
                <InputIcon icon={Phone} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+966 50 000 0000" />
              </div>
              <div className="space-y-2">
                <Label>{t("pages.profile.country")}</Label>
                <InputIcon icon={Globe} value={country} onChange={e => setCountry(e.target.value)} placeholder="المملكة العربية السعودية" />
              </div>
            </div>
            <div className="pt-2">
              <Button variant="primary" className="gap-2" onClick={handleSaveInfo} disabled={savingInfo}>
                {savingInfo ? <Loader2 className="size-4 animate-spin" /> : null}
                حفظ التغييرات
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ─── ─── ─── SECTION: ① Password ─── ─── ─── */}
      {section === "password" && (
        <SectionCard number={1} icon={Lock} title="تغيير كلمة المرور" accent="primary">
          <div className="space-y-4 max-w-lg">
            <div className="space-y-2">
              <Label>كلمة المرور الحالية</Label>
              <div className="relative">
                <InputIcon icon={Lock} type={showCurrent ? "text" : "password"} value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute end-3 top-1/2 -translate-y-1/2">
                  {showCurrent ? <EyeOff className="size-4 text-[var(--color-fg-muted)]" /> : <Eye className="size-4 text-[var(--color-fg-muted)]" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <div className="relative">
                <InputIcon icon={KeyRound} type={showNew ? "text" : "password"} value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShowNew(!showNew)} className="absolute end-3 top-1/2 -translate-y-1/2">
                  {showNew ? <EyeOff className="size-4 text-[var(--color-fg-muted)]" /> : <Eye className="size-4 text-[var(--color-fg-muted)]" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>تأكيد كلمة المرور</Label>
              <InputIcon icon={KeyRound} type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="••••••••" />
            </div>
            <Button onClick={handleChangePassword} disabled={saving || !currentPass || !newPass || !confirmPass} className="w-full gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              حفظ كلمة المرور
            </Button>
          </div>
        </SectionCard>
      )}

      {/* ─── ─── ─── SECTION: ② Plan / Subscription ─── ─── ─── */}
      {section === "plan" && (
        <div className="space-y-6">
          <SectionCard number={2} icon={CreditCard} title="الاشتراك" accent="primary">
            <div className="space-y-5">
              {/* Plan card with gradient */}
              <div className="rounded-xl overflow-hidden border border-[var(--color-border)]">
                <div className="gradient-brand p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <Badge className="bg-white/20 border-white/30 text-white text-xs">{t("pages.subscription.currentPlan")}</Badge>
                      <h3 className="mt-2 text-xl font-extrabold">{t("pages.subscription.plans.pro")}</h3>
                      <p className="mt-1 text-sm text-white/80">{t("pages.subscription.plans.proDesc")}</p>
                    </div>
                    <Package className="size-10 opacity-40" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-white/80">{t("pages.subscription.renewsOn")} 2026-08-20</span>
                    <span className="text-white/60 hidden sm:inline">•</span>
                    <span className="text-white/80 font-semibold">$79 {t("pages.subscription.perMonth")}</span>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid gap-3 grid-cols-3">
                <div className="rounded-xl bg-[var(--color-surface-2)] p-4 text-center">
                  <Gauge className="mx-auto size-6 text-[var(--color-primary)]" />
                  <p className="mt-1.5 text-lg font-extrabold">12,840</p>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("pages.subscription.usageLabel")}</p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-4 text-center">
                  <Package className="mx-auto size-6 text-[var(--color-success)]" />
                  <p className="mt-1.5 text-lg font-extrabold">$79</p>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("pages.subscription.monthlyCost")}</p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-4 text-center">
                  <ArrowUpCircle className="mx-auto size-6 text-[var(--color-warning)]" />
                  <p className="mt-1.5 text-lg font-extrabold">87,160</p>
                  <p className="text-[11px] text-[var(--color-fg-muted)]">{t("pages.subscription.remaining")}</p>
                </div>
              </div>

              {/* Upgrade CTA */}
              <Button variant="primary" size="lg" className="w-full gap-2">
                <ArrowUpCircle className="size-4" />
                {t("pages.subscription.upgrade")}
              </Button>
            </div>
          </SectionCard>

          {/* Usage details */}
          <Card>
            <CardHeader><CardTitle className="text-lg">{t("pages.subscription.usageDetails")}</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {PLAN_USAGE.map((u) => {
                const pct = Math.round((u.used / u.total) * 100);
                return (
                  <div key={u.labelKey}>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="font-medium text-[var(--color-fg)]">{t(u.labelKey)}</span>
                      <span className="text-[var(--color-fg-muted)]">{u.used.toLocaleString()} / {u.total.toLocaleString()}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          pct > 80 ? "bg-[var(--color-error)]" : pct > 50 ? "bg-[var(--color-warning)]" : "gradient-brand",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── ─── ─── SECTION: ④ Appearance ─── ─── ─── */}
      {section === "appearance" && (
        <div className="space-y-6">
          <SectionCard number={4} icon={Palette} title={t("pages.appearance.title")} accent="primary">
            <div className="space-y-6">
              {/* Theme */}
              <div>
                <Label className="text-sm font-semibold mb-3 block">{t("pages.appearance.theme")}</Label>
                <ThemeToggleFull />
              </div>

              {/* Language */}
              <div className="border-t border-[var(--color-border)] pt-5">
                <Label className="text-sm font-semibold mb-3 block">{t("pages.appearance.language")}</Label>
                <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                  <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.appearance.languageDesc")}</p>
                  <LanguageSwitcher />
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ─── ─── ─── SECTION: ⑤ Notifications ─── ─── ─── */}
      {section === "notifications" && (
        <div className="space-y-6">
          <SectionCard number={5} icon={Bell} title={t("pages.notifications.title")} accent="primary">
             <div className="space-y-6">
              {/* Events */}
              <div className="border-t border-[var(--color-border)] pt-5">
                <Label className="text-sm font-semibold mb-3 block">{t("pages.notifications.eventsTitle")}</Label>
                <div className="space-y-2">
                  {NOTIF_EVENTS.map((ev) => (
                    <div key={ev.key} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
                      <span className="text-sm font-medium text-[var(--color-fg)]">{t(ev.labelKey)}</span>
                      <Toggle checked={eventStates[ev.key]} onChange={(v) => setEventStates((p) => ({ ...p, [ev.key]: v }))} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// SectionCard (premium wrapper)
// ═══════════════════════════════════════════════
function SectionCard({
  number,
  icon: Icon,
  title,
  accent: _accent = "primary",
  children,
}: {
  number: number;
  icon: typeof UserCircle;
  title: string;
  accent?: "primary";
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center gap-3 pb-3">
        <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]">
          {number}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-[var(--color-primary)]" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Toggle({ checked, onChange, defaultChecked = true }: { checked?: boolean; onChange?: (v: boolean) => void; defaultChecked?: boolean }) {
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked !== undefined ? checked : internal;
  const handleClick = () => {
    const next = !on;
    setInternal(next);
    onChange?.(next);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
       onClick={handleClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        on ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-5 rounded-full bg-white shadow transform transition-transform duration-200",
          on ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

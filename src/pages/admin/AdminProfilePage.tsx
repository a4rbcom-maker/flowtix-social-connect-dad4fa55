import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  UserCircle, Mail, Phone, Camera, Lock, Eye, EyeOff, KeyRound, Loader2, Save,
  Shield, BadgeCheck, ShieldCheck, Sparkles, Trash2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Section = "profile" | "password" | "security";

export function AdminProfilePage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<Section>("profile");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const { data: profileData } = useQuery({
    queryKey: ["admin-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data, error: err } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (err) throw err;
      return { profile: data, email: user.email ?? "", user };
    },
  });

  useEffect(() => {
    if (profileData?.profile) {
      setFullName(profileData.profile.full_name || "");
      setPhone(profileData.profile.phone || "");
    }
  }, [profileData]);

  const handleChangeProfile = async () => {
    if (!profileData?.profile?.user_id) return;
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        })
        .eq("user_id", profileData.profile.user_id);

      if (updateError) throw new Error(updateError.message);

      await queryClient.invalidateQueries({ queryKey: ["admin-profile"] });
      toast({ type: "success", title: t("admin.profile.saveChangesSuccess") });
    } catch (e: any) {
      toast({ type: "error", title: e.message || t("admin.profile.saveChangesError") });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profileData?.profile?.user_id) return;
    if (!file.type.startsWith("image/")) {
      toast({ type: "error", title: t("admin.profile.avatarInvalidType") });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ type: "error", title: t("admin.profile.avatarTooLarge") });
      return;
    }

    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `avatars/${profileData.profile.user_id}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      const avatarUrl = urlData.publicUrl + "?t=" + Date.now();

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("user_id", profileData.profile.user_id);
      if (updateError) throw new Error(updateError.message);

      await queryClient.invalidateQueries({ queryKey: ["admin-profile"] });
      toast({ type: "success", title: t("admin.profile.avatarUpdated") });
    } catch (e: any) {
      toast({ type: "error", title: e.message || t("admin.profile.avatarUpdateError") });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    if (!profileData?.profile?.user_id) return;
    setAvatarUploading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("user_id", profileData.profile.user_id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["admin-profile"] });
      toast({ type: "success", title: t("admin.profile.avatarRemoved") });
    } catch (e: any) {
      toast({ type: "error", title: e.message || t("admin.profile.avatarUpdateError") });
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPass.length < 8) {
      toast({ type: "error", title: t("admin.profile.passwordLength") });
      return;
    }
    if (newPass !== confirmPass) {
      toast({ type: "error", title: t("admin.profile.passwordMismatch") });
      return;
    }
    setSavingPassword(true);
    try {
      const { error: errorData } = await supabase.auth.updateUser({ password: newPass });
      if (errorData) throw new Error(errorData.message);
      setCurrentPass(""); setNewPass(""); setConfirmPass("");
      toast({ type: "success", title: t("admin.profile.savePasswordSuccess") });
    } catch (e: any) {
      toast({ type: "error", title: e.message || t("admin.profile.savePasswordError") });
    } finally {
      setSavingPassword(false);
    }
  };

  const memberSince = profileData?.user?.created_at
    ? new Date(profileData.user.created_at).toLocaleDateString(i18n.language === "ar" ? "ar-SA" : "en-US", {
        month: "long",
        year: "numeric",
      })
    : "—";

  const sections: { key: Section; icon: typeof UserCircle; labelKey: string; number: number }[] = [
    { key: "profile", icon: UserCircle, labelKey: "admin.profile.info", number: 1 },
    { key: "password", icon: Lock, labelKey: "admin.profile.password", number: 2 },
    { key: "security", icon: Shield, labelKey: "admin.profile.security", number: 3 },
  ];

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("admin.profile.title")}
        description={t("admin.profile.description")}
        icon={UserCircle}
      />

      {/* ─── Banner & Avatar ─── */}
      <Card className="overflow-hidden">
        <div className="relative h-32 sm:h-40 bg-gradient-to-r from-[var(--color-primary)]/30 via-[var(--color-primary)]/15 to-[var(--color-secondary)]/20">
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.15),transparent_50%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.1),transparent_50%)]" aria-hidden />
          <div className="absolute top-4 end-4 flex items-center gap-2">
            <Badge variant="primary" className="gap-1.5 bg-white/15 backdrop-blur border-white/20 text-white">
              <ShieldCheck className="size-3" />
              {t(`admin.roles.${profileData?.profile?.status || "active"}`)}
            </Badge>
          </div>
        </div>

        <CardContent className="flex flex-col sm:flex-row items-center sm:items-end -mt-16 pb-6 px-6 gap-4 sm:gap-6">
          <div className="relative group shrink-0">
            <div className="size-28 sm:size-32 rounded-full bg-[var(--color-bg)] border-4 border-[var(--color-bg)] shadow-xl overflow-hidden flex items-center justify-center">
              {profileData?.profile?.avatar_url ? (
                <img
                  src={profileData.profile.avatar_url}
                  alt={profileData.profile.full_name ?? ""}
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full bg-gradient-to-br from-[var(--color-primary)]/25 to-[var(--color-primary)]/5 flex items-center justify-center">
                  <UserCircle className="size-16 text-[var(--color-primary)]/40" />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute bottom-1 end-1 size-9 rounded-full gradient-brand text-white border-2 border-[var(--color-bg)] flex items-center justify-center shadow-lg hover:scale-105 transition-transform disabled:opacity-60"
              aria-label={t("admin.profile.changeAvatar")}
            >
              {avatarUploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>

          <div className="text-center sm:text-start flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h2 className="text-2xl font-extrabold tracking-tight">
                {profileData?.profile?.full_name || profileData?.email?.split("@")[0] || "—"}
              </h2>
              <BadgeCheck className="size-5 text-[var(--color-primary)]" />
            </div>
            <p className="mt-1 text-sm text-[var(--color-fg-muted)] truncate">{profileData?.email || "—"}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-xs text-[var(--color-fg-subtle)]">
              <span className="flex items-center gap-1">
                <Sparkles className="size-3" />
                {t("admin.profile.memberSince")} {memberSince}
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="size-3" />
                {t("admin.profile.superAdminBadge")}
              </span>
            </div>
          </div>

          {profileData?.profile?.avatar_url && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveAvatar}
              disabled={avatarUploading}
              className="gap-1.5 text-[var(--color-error)] hover:text-[var(--color-error)]"
            >
              <Trash2 className="size-3.5" />
              {t("admin.profile.removeAvatar")}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ─── Section Tabs ─── */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--color-surface-2)] p-1 w-fit">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200",
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
              {t(s.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ─── SECTION: Profile ─── */}
      {section === "profile" && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center gap-3 pb-3 border-b border-[var(--color-border)]">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]">
              1
            </span>
            <SectionHeader
              title={t("admin.profile.info")}
              description={t("admin.profile.infoDesc")}
              icon={UserCircle}
            />
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("admin.profile.fullName")}</Label>
                <div className="relative">
                  <UserCircle className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ps-10 pe-4 py-2.5 text-sm text-[var(--color-fg)] outline-none transition-all focus:border-[var(--color-primary)]/50 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                    placeholder={t("auth.fields.fullNamePlaceholder")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  {t("auth.fields.email")}
                  <Badge variant="default" className="text-[0.6rem]">{t("admin.profile.readOnly")}</Badge>
                </Label>
                <div className="relative">
                  <Mail className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                  <input
                    type="email"
                    value={profileData?.email || ""}
                    disabled
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] ps-10 pe-4 py-2.5 text-sm text-[var(--color-fg-muted)] cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-[var(--color-fg-subtle)]">{t("admin.profile.emailDisabled")}</p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>{t("admin.profile.phone")}</Label>
                <div className="relative">
                  <Phone className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ps-10 pe-4 py-2.5 text-sm text-[var(--color-fg)] outline-none transition-all focus:border-[var(--color-primary)]/50 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                    placeholder="+966 50 000 0000"
                    dir="ltr"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--color-border)]">
              <Button
                variant="ghost"
                onClick={() => {
                  if (profileData?.profile) {
                    setFullName(profileData.profile.full_name || "");
                    setPhone(profileData.profile.phone || "");
                  }
                }}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleChangeProfile}
                disabled={saving || !fullName.trim()}
                className="gap-2"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t("admin.profile.saveChanges")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── SECTION: Password ─── */}
      {section === "password" && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center gap-3 pb-3 border-b border-[var(--color-border)]">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]">
              2
            </span>
            <SectionHeader
              title={t("admin.profile.changePassword")}
              description={t("admin.profile.changePasswordDesc")}
              icon={Lock}
            />
          </CardHeader>
          <CardContent className="space-y-5 pt-6 max-w-2xl">
            <div className="space-y-2">
              <Label>{t("admin.profile.currentPassword")}</Label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPass}
                  onChange={(e) => setCurrentPass(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ps-10 pe-10 py-2.5 text-sm text-[var(--color-fg)] outline-none transition-all focus:border-[var(--color-primary)]/50 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors p-1"
                  aria-label={showCurrent ? t("admin.profile.hidePassword") : t("admin.profile.showPassword")}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("auth.fields.newPassword")}</Label>
                <div className="relative">
                  <KeyRound className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ps-10 pe-10 py-2.5 text-sm text-[var(--color-fg)] outline-none transition-all focus:border-[var(--color-primary)]/50 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors p-1"
                    aria-label={showNew ? t("admin.profile.hidePassword") : t("admin.profile.showPassword")}
                  >
                    {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <PasswordStrength password={newPass} />
              </div>

              <div className="space-y-2">
                <Label>{t("auth.fields.confirmPassword")}</Label>
                <div className="relative">
                  <KeyRound className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)] pointer-events-none" />
                  <input
                    type="password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className={cn(
                      "w-full rounded-lg border bg-[var(--color-surface)] ps-10 pe-10 py-2.5 text-sm text-[var(--color-fg)] outline-none transition-all focus:ring-2",
                      confirmPass && confirmPass !== newPass
                        ? "border-[var(--color-error)]/50 focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/10"
                        : "border-[var(--color-border)] focus:border-[var(--color-primary)]/50 focus:ring-[var(--color-primary)]/10",
                    )}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    dir="ltr"
                  />
                  {confirmPass && confirmPass === newPass && (
                    <BadgeCheck className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-success)]" />
                  )}
                </div>
                {confirmPass && confirmPass !== newPass && (
                  <p className="text-xs text-[var(--color-error)]">{t("admin.profile.passwordMismatch")}</p>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-[var(--color-surface-2)]/60 border border-[var(--color-border)] p-3 text-xs text-[var(--color-fg-muted)]">
              <p className="font-semibold text-[var(--color-fg)] mb-1">{t("admin.profile.passwordTips")}</p>
              <ul className="space-y-0.5 list-disc ps-4">
                <li>{t("admin.profile.passwordTip1")}</li>
                <li>{t("admin.profile.passwordTip2")}</li>
                <li>{t("admin.profile.passwordTip3")}</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => { setCurrentPass(""); setNewPass(""); setConfirmPass(""); }}
                disabled={savingPassword}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleChangePassword}
                disabled={savingPassword || !currentPass || !newPass || !confirmPass || newPass !== confirmPass}
                className="gap-2"
              >
                {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
                {t("admin.profile.savePassword")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── SECTION: Security ─── */}
      {section === "security" && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center gap-3 pb-3 border-b border-[var(--color-border)]">
            <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]">
              3
            </span>
            <SectionHeader
              title={t("admin.profile.security")}
              description={t("admin.profile.securityDesc")}
              icon={Shield}
            />
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <SecurityItem
                icon={BadgeCheck}
                title={t("admin.profile.emailVerified")}
                desc={t("admin.profile.emailVerifiedDesc")}
                status="success"
              />
              <SecurityItem
                icon={ShieldCheck}
                title={t("admin.profile.strongPassword")}
                desc={t("admin.profile.strongPasswordDesc")}
                status="success"
              />
              <SecurityItem
                icon={Lock}
                title={t("admin.profile.sessionActive")}
                desc={t("admin.profile.sessionActiveDesc")}
                status="success"
              />
              <SecurityItem
                icon={Shield}
                title={t("admin.profile.adminPrivileges")}
                desc={t("admin.profile.adminPrivilegesDesc")}
                status="warning"
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════
function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  if (!password) return null;

  const score = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  const levels = [
    { label: t("admin.profile.passwordWeak"), color: "bg-[var(--color-error)]", width: "20%" },
    { label: t("admin.profile.passwordFair"), color: "bg-[var(--color-warning)]", width: "40%" },
    { label: t("admin.profile.passwordGood"), color: "bg-[var(--color-info)]", width: "60%" },
    { label: t("admin.profile.passwordStrong"), color: "bg-[var(--color-success)]", width: "80%" },
    { label: t("admin.profile.passwordVeryStrong"), color: "bg-[var(--color-success)]", width: "100%" },
  ];
  const level = levels[Math.min(score, levels.length) - 1] ?? levels[0];

  return (
    <div className="space-y-1.5 pt-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className={cn("h-full rounded-full transition-all duration-300", level.color)} style={{ width: level.width }} />
      </div>
      <p className="text-xs text-[var(--color-fg-subtle)]">{level.label}</p>
    </div>
  );
}

function SecurityItem({
  icon: Icon,
  title,
  desc,
  status,
}: {
  icon: typeof UserCircle;
  title: string;
  desc: string;
  status: "success" | "warning" | "info";
}) {
  const styles = {
    success: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
    warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
    info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-4">
      <div className={cn("flex size-10 items-center justify-center rounded-xl shrink-0", styles[status])}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-fg)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{desc}</p>
      </div>
    </div>
  );
}

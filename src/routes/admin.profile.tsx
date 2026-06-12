import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User as UserIcon, Mail, Lock, Save, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/profile")({
  ssr: false,
  component: AdminProfilePage,
});

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "الاسم قصير جداً").max(100),
});
const passwordSchema = z
  .object({
    new_password: z.string().min(8, "8 أحرف على الأقل").max(72),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirm_password"],
  });
const emailSchema = z.string().trim().email("بريد غير صالح").max(255);

function AdminProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();

  const T = lang === "ar"
    ? {
        title: "ملفي الشخصي - السوبر أدمن",
        subtitle: "إدارة بيانات حساب السوبر أدمن",
        badge: "حساب السوبر أدمن",
        info: "المعلومات الشخصية",
        infoDesc: "حدّث اسمك المعروض",
        fullName: "الاسم الكامل",
        save: "حفظ التغييرات",
        saving: "جاري الحفظ...",
        emailSec: "البريد الإلكتروني",
        emailDesc: "سيتم إرسال رسالة تأكيد إلى البريد الجديد ولن يتم التحديث إلا بعد الضغط على الرابط",
        currentEmail: "البريد الحالي",
        newEmail: "البريد الجديد",
        updateEmail: "تحديث البريد",
        passwordSec: "كلمة المرور",
        passwordDesc: "اختر كلمة مرور قوية لا تقل عن 8 أحرف",
        newPassword: "كلمة المرور الجديدة",
        confirmPassword: "تأكيد كلمة المرور",
        updatePassword: "تحديث كلمة المرور",
        accountId: "معرّف الحساب",
        joined: "تاريخ الانضمام",
        dangerZone: "منطقة الخطر",
        signOutAll: "تسجيل الخروج من كل الأجهزة",
        signOutAllDesc: "إنهاء كل الجلسات النشطة على جميع الأجهزة",
        confirmSignOut: "هل أنت متأكد؟",
        success: "تم الحفظ بنجاح",
        emailSent: "تم إرسال رابط التأكيد إلى بريدك الجديد. افتح الرابط لإتمام التغيير.",
        passUpdated: "تم تحديث كلمة المرور",
        signedOutAll: "تم تسجيل الخروج من كل الأجهزة",
      }
    : {
        title: "My Profile - Super Admin",
        subtitle: "Manage your super admin account",
        badge: "Super Admin Account",
        info: "Personal Information",
        infoDesc: "Update your display name",
        fullName: "Full name",
        save: "Save changes",
        saving: "Saving...",
        emailSec: "Email Address",
        emailDesc: "A confirmation will be sent to the new email; the change applies only after you click the link",
        currentEmail: "Current email",
        newEmail: "New email",
        updateEmail: "Update email",
        passwordSec: "Password",
        passwordDesc: "Choose a strong password (min 8 characters)",
        newPassword: "New password",
        confirmPassword: "Confirm password",
        updatePassword: "Update password",
        accountId: "Account ID",
        joined: "Joined",
        dangerZone: "Danger Zone",
        signOutAll: "Sign out from all devices",
        signOutAllDesc: "Terminate all active sessions on every device",
        confirmSignOut: "Are you sure?",
        success: "Saved successfully",
        emailSent: "Confirmation link sent to your new email. Click it to complete the change.",
        passUpdated: "Password updated",
        signedOutAll: "Signed out from all devices",
      };

  const [fullName, setFullName] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadingProfile(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) toast.error(error.message);
      else if (data) setFullName(data.full_name ?? "");
      setLoadingProfile(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = profileSchema.safeParse({ full_name: fullName });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid"); return; }
    setSavingProfile(true);
    const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name }).eq("id", user.id);
    if (error) toast.error(error.message);
    else {
      await supabase.auth.updateUser({ data: { full_name: parsed.data.full_name } });
      toast.success(T.success);
    }
    setSavingProfile(false);
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(newEmail);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid email"); return; }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser(
      { email: parsed.data },
      { emailRedirectTo: `${window.location.origin}/admin/profile` },
    );
    if (error) toast.error(error.message);
    else { toast.success(T.emailSent); setNewEmail(""); }
    setSavingEmail(false);
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse({ new_password: newPassword, confirm_password: confirmPassword });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid"); return; }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.new_password });
    if (error) toast.error(error.message);
    else { toast.success(T.passUpdated); setNewPassword(""); setConfirmPassword(""); }
    setSavingPassword(false);
  };

  const handleSignOutAll = async () => {
    if (!confirm(T.confirmSignOut)) return;
    setSigningOutAll(true);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) toast.error(error.message);
    else toast.success(T.signedOutAll);
    setSigningOutAll(false);
  };

  const initial = (fullName || user?.email || "?").charAt(0).toUpperCase();
  const joined = user?.created_at ? new Date(user.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US") : "—";

  if (authLoading || loadingProfile) {
    return (
      <AdminLayout title={T.title}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={T.title}>
      <div dir={dir} className="mx-auto max-w-3xl space-y-6">
        {/* Header card */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-400/40 to-primary/40 blur-md" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-primary text-2xl font-bold text-white ring-2 ring-background">
                {initial}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold text-foreground">{fullName || user?.email}</h2>
              <p className="truncate text-sm text-muted-foreground" dir="ltr">{user?.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-600 dark:text-amber-400">
                  <ShieldCheck className="h-3 w-3" /> {T.badge}
                </span>
                <span className="text-muted-foreground">{T.joined}: {joined}</span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{T.subtitle}</p>

        {/* Personal info */}
        <form onSubmit={handleSaveProfile} className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserIcon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{T.info}</h3>
              <p className="text-xs text-muted-foreground">{T.infoDesc}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">{T.fullName}</Label>
              <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} required />
            </div>
            <Button type="submit" disabled={savingProfile} className="w-full sm:w-auto gap-2">
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingProfile ? T.saving : T.save}
            </Button>
          </div>
        </form>

        {/* Email */}
        <form onSubmit={handleUpdateEmail} className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{T.emailSec}</h3>
              <p className="text-xs text-muted-foreground">{T.emailDesc}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{T.currentEmail}</Label>
              <Input value={user?.email ?? ""} disabled dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_email">{T.newEmail}</Label>
              <Input id="new_email" type="email" dir="ltr" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" maxLength={255} />
            </div>
            <Button type="submit" disabled={savingEmail || !newEmail} variant="outline" className="w-full sm:w-auto gap-2">
              {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {T.updateEmail}
            </Button>
          </div>
        </form>

        {/* Password */}
        <form onSubmit={handleUpdatePassword} className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{T.passwordSec}</h3>
              <p className="text-xs text-muted-foreground">{T.passwordDesc}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new_password">{T.newPassword}</Label>
              <Input id="new_password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} maxLength={72} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm_password">{T.confirmPassword}</Label>
              <Input id="confirm_password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} maxLength={72} />
            </div>
            <Button type="submit" disabled={savingPassword || !newPassword || !confirmPassword} variant="outline" className="w-full sm:w-auto gap-2">
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {T.updatePassword}
            </Button>
          </div>
        </form>

        {/* Danger zone */}
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-destructive">{T.dangerZone}</h3>
              <p className="text-xs text-muted-foreground">{T.signOutAllDesc}</p>
            </div>
          </div>
          <Button onClick={handleSignOutAll} disabled={signingOutAll} variant="destructive" className="w-full sm:w-auto gap-2">
            {signingOutAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {T.signOutAll}
          </Button>
        </div>

        {/* Account meta */}
        <div className="rounded-2xl border border-border/50 bg-muted/30 p-4 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{T.accountId}</span>
            <code className="rounded bg-background px-2 py-1 font-mono text-[11px]">{user?.id}</code>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

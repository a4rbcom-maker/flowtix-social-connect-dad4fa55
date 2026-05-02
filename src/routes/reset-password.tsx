import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Navbar } from "@/components/landing/Navbar";
import { Lock, Loader2, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(6, { message: "Password must be at least 6 characters" })
  .max(72, { message: "Password must be less than 72 characters" });

function ResetPasswordPage() {
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState<boolean | null>(null);

  // Supabase places the recovery token in the URL hash (#access_token=...&type=recovery)
  // and detectSessionInUrl will create a session + fire PASSWORD_RECOVERY.
  // We listen for that event AND check existing session, with a longer grace period.
  useEffect(() => {
    let resolved = false;

    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      setValidSession(ok);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        finish(true);
      }
    });

    // Also check immediately in case the event fired before we mounted
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });

    // If URL has a recovery hash, give Supabase up to 3s to process it
    const hasRecoveryHash =
      typeof window !== "undefined" &&
      (window.location.hash.includes("type=recovery") ||
        window.location.hash.includes("access_token") ||
        window.location.search.includes("code="));

    const timeout = setTimeout(() => finish(false), hasRecoveryHash ? 3500 : 1200);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const t = lang === "ar"
    ? {
        title: "إعادة تعيين كلمة المرور",
        subtitle: "أدخل كلمة المرور الجديدة الخاصة بك",
        password: "كلمة المرور الجديدة",
        confirm: "تأكيد كلمة المرور",
        passwordPh: "••••••••",
        save: "حفظ كلمة المرور",
        saving: "جاري الحفظ...",
        mismatch: "كلمتا المرور غير متطابقتين",
        successTitle: "تم تحديث كلمة المرور",
        successDesc: "يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",
        goLogin: "الذهاب لتسجيل الدخول",
        invalidTitle: "الرابط غير صالح أو منتهي الصلاحية",
        invalidDesc: "يرجى طلب رابط جديد لإعادة تعيين كلمة المرور.",
        requestNew: "طلب رابط جديد",
        back: "العودة للرئيسية",
        loading: "التحقق من الرابط...",
      }
    : {
        title: "Reset Password",
        subtitle: "Enter your new password below",
        password: "New password",
        confirm: "Confirm password",
        passwordPh: "••••••••",
        save: "Save password",
        saving: "Saving...",
        mismatch: "Passwords do not match",
        successTitle: "Password updated",
        successDesc: "You can now sign in with your new password.",
        goLogin: "Go to sign in",
        invalidTitle: "Invalid or expired link",
        invalidDesc: "Please request a new password reset link.",
        requestNew: "Request new link",
        back: "Back to home",
        loading: "Verifying link...",
      };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (password !== confirm) {
      setError(t.mismatch);
      return;
    }

    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: parsed.data });
      if (err) throw err;
      setDone(true);
      // sign out so the user logs in fresh with the new password
      setTimeout(async () => {
        await supabase.auth.signOut();
      }, 200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "peer w-full rounded-xl border border-input bg-background/60 backdrop-blur ps-12 pe-4 py-3 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60";

  return (
    <div dir={dir} className="min-h-screen bg-background">
      <Navbar />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/20 blur-[120px]" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4 pt-28 pb-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              {t.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>

          <div className="relative rounded-3xl border border-border/50 bg-card/80 p-7 shadow-2xl shadow-primary/5 backdrop-blur-xl sm:p-8">
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-primary/5 to-transparent" />

            {validSession === null ? (
              <div className="relative flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm">{t.loading}</p>
              </div>
            ) : validSession === false ? (
              <div className="relative space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t.invalidTitle}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t.invalidDesc}</p>
                </div>
                <Link
                  to="/forgot-password"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40"
                >
                  {t.requestNew}
                </Link>
              </div>
            ) : done ? (
              <div className="relative space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t.successTitle}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t.successDesc}</p>
                </div>
                <button
                  onClick={() => navigate({ to: "/login" })}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40"
                >
                  {t.goLogin} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="relative space-y-4">
                <PasswordField label={t.password} value={password} onChange={setPassword} placeholder={t.passwordPh} inputClass={inputClass} />
                <PasswordField label={t.confirm} value={confirm} onChange={setConfirm} placeholder={t.passwordPh} inputClass={inputClass} />

                {error && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary to-primary/80 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t.saving}</>
                  ) : (
                    <>
                      {t.save}
                      <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          <div className="mt-6 text-center">
            <Link to="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              ← {t.back}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  inputClass,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputClass: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground/80">{label}</label>
      <div className="group relative">
        <div className="pointer-events-none absolute start-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
          <Lock className="h-[18px] w-[18px] text-primary" strokeWidth={2.25} />
        </div>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={6}
          maxLength={72}
          placeholder={placeholder}
          dir="ltr"
          className={inputClass}
        />
      </div>
    </div>
  );
}

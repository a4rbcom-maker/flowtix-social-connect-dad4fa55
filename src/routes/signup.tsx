import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Navbar } from "@/components/landing/Navbar";
import {
  Mail, Lock, User, Phone, Loader2, ArrowRight, Eye, EyeOff,
  CheckCircle2, ShieldCheck, Sparkles, AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const { lang, dir } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate({ to: "/dashboard" });
    return null;
  }

  const t = lang === "ar" ? {
    title: "إنشاء حساب جديد",
    subtitle: "ابدأ مجاناً في أقل من دقيقة — لا حاجة لبطاقة ائتمان",
    name: "الاسم الكامل",
    namePh: "محمد أحمد",
    phone: "رقم الجوال (اختياري)",
    phonePh: "+966 5x xxx xxxx",
    email: "البريد الإلكتروني",
    emailPh: "you@example.com",
    password: "كلمة المرور",
    passwordPh: "8 أحرف على الأقل",
    confirm: "تأكيد كلمة المرور",
    confirmPh: "أعد كتابة كلمة المرور",
    show: "إظهار",
    hide: "إخفاء",
    terms: "أوافق على شروط الاستخدام وسياسة الخصوصية",
    submit: "إنشاء الحساب",
    submitting: "جاري الإنشاء...",
    haveAccount: "لديك حساب بالفعل؟",
    signin: "سجّل الدخول",
    back: "العودة للرئيسية",
    success: "تم إنشاء حسابك بنجاح! تحقق من بريدك الإلكتروني لتأكيد الحساب قبل تسجيل الدخول.",
    benefits: ["مجاناً للأبد على الباقة المجانية", "ربط فيسبوك وواتساب بنقرة", "بدون التزامات أو بطاقة ائتمان"],
    strength: ["ضعيفة جداً", "ضعيفة", "متوسطة", "قوية", "قوية جداً"],
    requirements: "متطلبات كلمة المرور",
    req8: "8 أحرف على الأقل",
    reqUpper: "حرف كبير واحد على الأقل (A-Z)",
    reqNumber: "رقم واحد على الأقل (0-9)",
    reqMatch: "كلمتا المرور متطابقتان",
    errMismatch: "كلمتا المرور غير متطابقتين",
    errTerms: "يجب الموافقة على الشروط للمتابعة",
    errInvalidEmail: "بريد إلكتروني غير صالح",
    errWeakPassword: "كلمة المرور لا تستوفي المتطلبات",
    errShortName: "الاسم قصير جداً",
  } : {
    title: "Create your account",
    subtitle: "Get started for free in under a minute — no credit card required",
    name: "Full name",
    namePh: "John Doe",
    phone: "Phone number (optional)",
    phonePh: "+1 555 123 4567",
    email: "Email address",
    emailPh: "you@example.com",
    password: "Password",
    passwordPh: "At least 8 characters",
    confirm: "Confirm password",
    confirmPh: "Re-type your password",
    show: "Show",
    hide: "Hide",
    terms: "I agree to the Terms of Service and Privacy Policy",
    submit: "Create account",
    submitting: "Creating...",
    haveAccount: "Already have an account?",
    signin: "Sign in",
    back: "Back to Home",
    success: "Account created! Check your inbox to confirm your email before signing in.",
    benefits: ["Free forever on the starter plan", "Connect Facebook & WhatsApp in one click", "No commitments, no credit card"],
    strength: ["Very weak", "Weak", "Fair", "Strong", "Very strong"],
    requirements: "Password requirements",
    req8: "At least 8 characters",
    reqUpper: "At least one uppercase letter (A-Z)",
    reqNumber: "At least one number (0-9)",
    reqMatch: "Passwords match",
    errMismatch: "Passwords don't match",
    errTerms: "You must agree to the terms to continue",
    errInvalidEmail: "Invalid email address",
    errWeakPassword: "Password doesn't meet the requirements",
    errShortName: "Name is too short",
  };

  // Password strength + checks
  const checks = useMemo(() => ({
    len: password.length >= 8,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    match: password.length > 0 && password === confirmPassword,
  }), [password, confirmPassword]);

  const strength = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  }, [password]);

  const strengthColors = ["bg-destructive", "bg-orange-500", "bg-amber-500", "bg-lime-500", "bg-green-500"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Client-side validation with zod
    const schema = z.object({
      fullName: z.string().trim().min(2, t.errShortName).max(100),
      phone: z.string().trim().max(30).optional().or(z.literal("")),
      email: z.string().trim().email(t.errInvalidEmail).max(255),
      password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
    });

    const parsed = schema.safeParse({ fullName, phone, email, password });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first.message === "Invalid input" ? t.errWeakPassword : first.message);
      return;
    }
    if (password !== confirmPassword) { setError(t.errMismatch); return; }
    if (!acceptTerms) { setError(t.errTerms); return; }

    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), phone: phone.trim() },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (signUpError) throw signUpError;
      setSuccess(t.success);
      // Reset sensitive fields
      setPassword("");
      setConfirmPassword("");
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

      {/* Decorative gradient */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/20 blur-[120px]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-6xl gap-10 px-4 pt-28 pb-12 lg:grid-cols-[1fr_minmax(0,440px)] lg:items-center">
        {/* Left: marketing panel */}
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {lang === "ar" ? "Flowtix Tools" : "Flowtix Tools"}
          </div>
          <h2 className="mt-4 bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-4xl font-bold leading-tight tracking-tight text-transparent">
            {t.title}
          </h2>
          <p className="mt-3 max-w-md text-base text-muted-foreground">{t.subtitle}</p>
          <ul className="mt-8 space-y-3">
            {t.benefits.map((b) => (
              <li key={b} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <span className="text-sm text-foreground/80">{b}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex items-center gap-2 rounded-xl border border-border/50 bg-card/60 p-3 text-xs text-muted-foreground backdrop-blur">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {lang === "ar" ? "بياناتك مشفّرة ومحمية بمعايير الأمان العالمية." : "Your data is encrypted and protected by industry-standard security."}
          </div>
        </div>

        {/* Right: form card */}
        <div className="w-full">
          <div className="mb-6 text-center lg:hidden">
            <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              {t.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>

          <div className="relative rounded-3xl border border-border/50 bg-card/80 p-7 shadow-2xl shadow-primary/5 backdrop-blur-xl sm:p-8">
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-primary/5 to-transparent" />

            <form onSubmit={handleSubmit} className="relative space-y-4">
              <Field icon={User} label={t.name}>
                <input
                  type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                  required maxLength={100} placeholder={t.namePh} className={inputClass}
                />
              </Field>

              <Field icon={Phone} label={t.phone}>
                <input
                  type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  maxLength={30} placeholder={t.phonePh} dir="ltr" className={inputClass}
                />
              </Field>

              <Field icon={Mail} label={t.email}>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required maxLength={255} placeholder={t.emailPh} dir="ltr" className={inputClass}
                  autoComplete="email"
                />
              </Field>

              <Field icon={Lock} label={t.password}>
                <input
                  type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={8}
                  placeholder={t.passwordPh} dir="ltr" className={`${inputClass} pe-14`}
                  autoComplete="new-password"
                />
                <button
                  type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute end-3 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={showPassword ? t.hide : t.show}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </Field>

              {/* Strength meter */}
              {password.length > 0 && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-all ${
                          i < strength ? strengthColors[strength] : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.strength[strength]}</p>
                </div>
              )}

              <Field icon={Lock} label={t.confirm}>
                <input
                  type={showPassword ? "text" : "password"} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8}
                  placeholder={t.confirmPh} dir="ltr" className={inputClass}
                  autoComplete="new-password"
                />
              </Field>

              {/* Live requirements checklist */}
              {(password.length > 0 || confirmPassword.length > 0) && (
                <div className="rounded-xl border border-border/50 bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.requirements}
                  </p>
                  <ul className="space-y-1 text-xs">
                    <Req ok={checks.len} label={t.req8} />
                    <Req ok={checks.upper} label={t.reqUpper} />
                    <Req ok={checks.number} label={t.reqNumber} />
                    <Req ok={checks.match} label={t.reqMatch} />
                  </ul>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-sm text-foreground/80">
                <input
                  type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-primary/20"
                />
                <span>{t.terms}</span>
              </label>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="flex items-start gap-2 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{success}</span>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary to-primary/80 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t.submit}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="relative mt-6 text-center text-sm text-muted-foreground">
              {t.haveAccount}{" "}
              <Link
                to="/login"
                className="font-semibold text-primary transition-colors hover:text-primary/80 hover:underline underline-offset-4"
              >
                {t.signin}
              </Link>
            </p>
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

function Field({
  icon: Icon, label, children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground/80">{label}</label>
      <div className="group relative">
        <div className="pointer-events-none absolute start-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 transition-all duration-300 group-focus-within:bg-primary/15 group-focus-within:ring-primary/30 group-focus-within:scale-105">
          <Icon className="relative h-[18px] w-[18px] text-primary transition-transform duration-300 group-focus-within:scale-110" strokeWidth={2.25} />
        </div>
        {children}
      </div>
    </div>
  );
}

function Req({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
      <CheckCircle2 className={`h-3.5 w-3.5 ${ok ? "" : "opacity-40"}`} />
      <span>{label}</span>
    </li>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Navbar } from "@/components/landing/Navbar";
import { Mail, Lock, User, Phone, Loader2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { lang, dir } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate({ to: "/dashboard" });
    return null;
  }

  const labels = lang === "ar"
    ? {
        login: "تسجيل الدخول",
        register: "إنشاء حساب جديد",
        loginSubtitle: "أهلاً بعودتك! سجل دخولك للمتابعة",
        registerSubtitle: "ابدأ رحلتك معنا في دقائق",
        email: "البريد الإلكتروني",
        emailPh: "you@example.com",
        password: "كلمة المرور",
        passwordPh: "••••••••",
        name: "الاسم الكامل",
        namePh: "محمد أحمد",
        phone: "رقم الجوال",
        phonePh: "+966 5x xxx xxxx",
        noAccount: "ليس لديك حساب؟",
        hasAccount: "لديك حساب بالفعل؟",
        createAccount: "أنشئ حساب",
        loginNow: "سجل دخول",
        checkEmail: "تحقق من بريدك الإلكتروني لتأكيد الحساب",
        back: "العودة للرئيسية",
        submit: "متابعة",
      }
    : {
        login: "Sign In",
        register: "Create Account",
        loginSubtitle: "Welcome back! Sign in to continue",
        registerSubtitle: "Start your journey with us in minutes",
        email: "Email",
        emailPh: "you@example.com",
        password: "Password",
        passwordPh: "••••••••",
        name: "Full Name",
        namePh: "John Doe",
        phone: "Phone Number",
        phonePh: "+1 555 123 4567",
        noAccount: "Don't have an account?",
        hasAccount: "Already have an account?",
        createAccount: "Sign Up",
        loginNow: "Sign In",
        checkEmail: "Check your email to confirm your account",
        back: "Back to Home",
        submit: "Continue",
      };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, phone },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setSuccess(labels.checkEmail);
      }
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

      {/* Decorative gradient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute top-1/3 left-0 h-72 w-72 rounded-full bg-primary/10 blur-[110px]" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4 pt-28 pb-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              {isLogin ? labels.login : labels.register}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? labels.loginSubtitle : labels.registerSubtitle}
            </p>
          </div>

          {/* Card */}
          <div className="relative rounded-3xl border border-border/50 bg-card/80 p-7 shadow-2xl shadow-primary/5 backdrop-blur-xl sm:p-8">
            {/* Subtle inner glow */}
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-primary/5 to-transparent" />

            <form onSubmit={handleSubmit} className="relative space-y-4">
              {!isLogin && (
                <>
                  <Field icon={User} label={labels.name}>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      placeholder={labels.namePh}
                      className={inputClass}
                    />
                  </Field>
                  <Field icon={Phone} label={labels.phone}>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      placeholder={labels.phonePh}
                      dir="ltr"
                      className={inputClass}
                    />
                  </Field>
                </>
              )}

              <Field icon={Mail} label={labels.email}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder={labels.emailPh}
                  dir="ltr"
                  className={inputClass}
                />
              </Field>

              <Field icon={Lock} label={labels.password}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder={labels.passwordPh}
                  dir="ltr"
                  className={inputClass}
                />
              </Field>

              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-sm text-green-600 dark:text-green-400">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-primary via-primary to-primary/80 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {isLogin ? labels.login : labels.submit}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="relative mt-6 text-center text-sm text-muted-foreground">
              {isLogin ? labels.noAccount : labels.hasAccount}{" "}
              <button
                onClick={() => { setIsLogin(!isLogin); setError(""); setSuccess(""); }}
                className="font-semibold text-primary transition-colors hover:text-primary/80 hover:underline underline-offset-4"
              >
                {isLogin ? labels.createAccount : labels.loginNow}
              </button>
            </p>
          </div>

          <div className="mt-6 text-center">
            <a href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              ← {labels.back}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
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

import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Navbar } from "@/components/landing/Navbar";
import { AlertCircle, Mail, Lock, User, Phone, Loader2, ArrowRight, Eye, EyeOff, ShieldCheck, Clock, LogIn } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { signInWithPasswordResilient, signUpWithPasswordResilient } from "@/lib/auth-proxy";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
  component: LoginPage,
});


function isSafeRedirect(path: string | undefined): path is string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return false;
  const authPaths = ["/login", "/signup", "/forgot-password", "/reset-password"];
  return !authPaths.some((authPath) => path === authPath || path.startsWith(`${authPath}?`));
}

function LoginPage() {
  const { lang, dir } = useI18n();
  const { user } = useAuth();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();
  
  const { redirect: redirectParam, reason: reasonParam } = Route.useSearch();

  const sessionNotice = (() => {
    if (!reasonParam) return null;
    const ar = lang === "ar";
    if (reasonParam === "expired") {
      return {
        icon: Clock,
        tone: "warning" as const,
        title: ar ? "انتهت جلستك" : "Your session expired",
        description: ar
          ? "لأسباب أمنية انتهت صلاحية جلستك بسبب طول فترة عدم النشاط. سجّل الدخول مجدداً للمتابعة من حيث توقفت."
          : "For your security, your session ended due to inactivity. Sign in again to pick up where you left off.",
      };
    }
    if (reasonParam === "signed_out") {
      return {
        icon: LogIn,
        tone: "info" as const,
        title: ar ? "تم تسجيل الخروج" : "You have been signed out",
        description: ar
          ? "تم إنهاء جلستك. سجّل الدخول مرة أخرى للوصول لحسابك."
          : "Your session has ended. Sign in again to access your account.",
      };
    }
    if (reasonParam === "auth_required") {
      return {
        icon: ShieldCheck,
        tone: "info" as const,
        title: ar ? "يلزم تسجيل الدخول" : "Sign-in required",
        description: ar
          ? "الصفحة التي حاولت فتحها تتطلب حساباً مسجلاً. سجّل الدخول لمتابعة الوصول."
          : "The page you tried to open requires an account. Sign in to continue.",
      };
    }
    return {
      icon: AlertCircle,
      tone: "warning" as const,
      title: ar ? "الرجاء تسجيل الدخول" : "Please sign in",
      description: ar ? "أعد تسجيل الدخول للمتابعة." : "Sign in again to continue.",
    };
  })();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);



  if (user && !isAdminLoading) {
    const fallback = isAdmin ? "/admin" : "/dashboard";
    const target = isSafeRedirect(redirectParam) ? redirectParam : fallback;
    return <Navigate to={target} />;
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
        forgot: "نسيت كلمة المرور؟",
        rememberMe: "تذكرني",
        invalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة. تأكد من البيانات أو استخدم نسيت كلمة المرور.",
        emailNotConfirmed: "حسابك لم يتم تأكيده بعد. تحقق من بريدك الإلكتروني ثم حاول مرة أخرى.",
        defaultError: "حدث خطأ غير متوقع. حاول مرة أخرى بعد لحظات.",
        unreachable: "تعذّر تسجيل الدخول حالياً حتى عبر الاتصال الاحتياطي من الخادم. تحقق من اتصال الإنترنت أو جرّب بعد لحظات.",
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
        forgot: "Forgot password?",
        rememberMe: "Remember me",
        invalidCredentials: "The email or password is incorrect. Check your details or use Forgot password.",
        emailNotConfirmed: "Your account is not confirmed yet. Check your email, then try again.",
        defaultError: "Something went wrong. Please try again in a moment.",
        unreachable: "Sign-in is currently unreachable even through the server fallback. Check your connection or try again shortly.",
      };

  const getFriendlyAuthError = (err: unknown) => {
    const parts: string[] = [];
    if (err instanceof Error) {
      parts.push(err.name, err.message);
    } else if (err && typeof err === "object") {
      const record = err as Record<string, unknown>;
      for (const key of ["name", "message", "code", "status", "error", "error_description"]) {
        const value = record[key];
        if (typeof value === "string" || typeof value === "number") parts.push(String(value));
      }
    } else {
      parts.push(String(err ?? ""));
    }
    const rawMsg = parts.filter(Boolean).join(" ");
    const message = rawMsg.toLowerCase();

    if (message.includes("invalid login credentials") || message.includes("invalid_credentials"))
      return labels.invalidCredentials;
    if (message.includes("email not confirmed")) return labels.emailNotConfirmed;
    if (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed") ||
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("load failed")
    ) {
      const online = typeof navigator !== "undefined" ? navigator.onLine : true;
      if (!online) {
        return lang === "ar"
          ? "لا يوجد اتصال بالإنترنت على جهازك. تحقق من الشبكة وحاول مجدداً."
          : "Your device is offline. Check your network and try again.";
      }
      return labels.unreachable;
    }
    if (message.includes("rate limit") || message.includes("too many")) {
      return lang === "ar"
        ? "محاولات كثيرة متتالية. انتظر قليلًا ثم حاول مجددًا."
        : "Too many attempts. Please wait a moment and try again.";
    }

    return labels.defaultError;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (isLogin) {
        localStorage.setItem("flowtix_remember_me", rememberMe ? "true" : "false");
        await signInWithPasswordResilient({ email: email.trim(), password }, 8_000);
        // Don't navigate manually — the role-aware <Navigate> gate above
        // redirects to /admin or /dashboard once useIsAdmin resolves.

      } else {
        await signUpWithPasswordResilient({
          email: email.trim(),
          password,
          fullName,
          phone,
          emailRedirectTo: window.location.origin,
        }, 8_000);
        setSuccess(labels.checkEmail);
      }
    } catch (err: unknown) {
      console.error("[login] auth error", err);
      setError(getFriendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "peer w-full rounded-xl border border-input bg-background/60 backdrop-blur pl-14 pr-4 py-3 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60";

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
            {isLogin && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === "ar" ? "دخول موحّد للعملاء والسوبر أدمن" : "Unified sign-in for clients & super admins"}
              </div>
            )}
            <h1 className="bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              {isLogin ? labels.login : labels.register}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? labels.loginSubtitle : labels.registerSubtitle}
            </p>
          </div>

          {/* Session-ended prominent notice */}
          {sessionNotice && (
            <div
              role="alert"
              className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur-md ${
                sessionNotice.tone === "warning"
                  ? "border-amber-400/40 bg-amber-50/80 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                  : "border-primary/30 bg-primary/10 text-foreground dark:text-foreground"
              }`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                sessionNotice.tone === "warning"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-200"
                  : "bg-primary/20 text-primary"
              }`}>
                <sessionNotice.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{sessionNotice.title}</div>
                <p className="mt-1 text-xs leading-6 opacity-90">{sessionNotice.description}</p>
              </div>
            </div>
          )}

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
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder={labels.passwordPh}
                  dir="ltr"
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? (lang === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (lang === "ar" ? "إظهار كلمة المرور" : "Show password")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors p-1 rounded-md"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </Field>

              {isLogin && (
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={rememberMe}
                      onCheckedChange={(v) => setRememberMe(v === true)}
                      id="remember-me"
                    />
                    <span className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                      {labels.rememberMe}
                    </span>
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-primary transition-colors hover:text-primary/80 hover:underline underline-offset-4"
                  >
                    {labels.forgot}
                  </Link>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
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
              {isLogin ? (
                <Link
                  to="/signup"
                  className="font-semibold text-primary transition-colors hover:text-primary/80 hover:underline underline-offset-4"
                >
                  {labels.createAccount}
                </Link>
              ) : (
                <button
                  onClick={() => { setIsLogin(true); setError(""); setSuccess(""); }}
                  className="font-semibold text-primary transition-colors hover:text-primary/80 hover:underline underline-offset-4"
                >
                  {labels.loginNow}
                </button>
              )}
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
        <div className="pointer-events-none absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 transition-all duration-300 group-focus-within:bg-primary/15 group-focus-within:ring-primary/30 group-focus-within:scale-105">
          <Icon className="relative h-[18px] w-[18px] text-primary transition-transform duration-300 group-focus-within:scale-110" strokeWidth={2.25} />
        </div>
        {children}
      </div>
    </div>
  );
}

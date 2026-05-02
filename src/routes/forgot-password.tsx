import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Navbar } from "@/components/landing/Navbar";
import { Mail, Loader2, ArrowRight, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

const emailSchema = z
  .string()
  .trim()
  .min(1, { message: "Email is required" })
  .email({ message: "Invalid email address" })
  .max(255);

function ForgotPasswordPage() {
  const { lang, dir } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const t = lang === "ar"
    ? {
        title: "نسيت كلمة المرور؟",
        subtitle: "أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور",
        email: "البريد الإلكتروني",
        emailPh: "you@example.com",
        send: "إرسال رابط إعادة التعيين",
        sending: "جاري الإرسال...",
        sentTitle: "تحقق من بريدك الإلكتروني",
        sentDesc: "أرسلنا رابط إعادة تعيين كلمة المرور إلى",
        sentNote: "إذا لم يصلك خلال دقائق، تحقق من مجلد الرسائل غير المرغوبة (Spam).",
        backToLogin: "العودة لتسجيل الدخول",
        back: "العودة للرئيسية",
      }
    : {
        title: "Forgot Password?",
        subtitle: "Enter your email and we'll send you a link to reset your password",
        email: "Email",
        emailPh: "you@example.com",
        send: "Send reset link",
        sending: "Sending...",
        sentTitle: "Check your email",
        sentDesc: "We've sent a password reset link to",
        sentNote: "If you don't receive it within a few minutes, check your spam folder.",
        backToLogin: "Back to sign in",
        back: "Back to home",
      };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw err;
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

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

            {sent ? (
              <div className="relative space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t.sentTitle}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t.sentDesc} <span className="font-medium text-foreground">{email}</span>
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">{t.sentNote}</p>
                </div>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  ← {t.backToLogin}
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="relative space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground/80">{t.email}</label>
                  <div className="group relative">
                    <div className="pointer-events-none absolute start-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                      <Mail className="h-[18px] w-[18px] text-primary" strokeWidth={2.25} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder={t.emailPh}
                      dir="ltr"
                      maxLength={255}
                      className="peer w-full rounded-xl border border-input bg-background/60 backdrop-blur ps-12 pe-4 py-3 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/60"
                    />
                  </div>
                </div>

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
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t.sending}</>
                  ) : (
                    <>
                      {t.send}
                      <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                    </>
                  )}
                </button>

                <p className="relative pt-2 text-center text-sm text-muted-foreground">
                  <Link to="/login" className="font-semibold text-primary hover:underline underline-offset-4">
                    ← {t.backToLogin}
                  </Link>
                </p>
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

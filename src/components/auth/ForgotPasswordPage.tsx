import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, ArrowLeft, KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email) { setError(t("auth.errors.required")); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (err) { setError(err.message); setLoading(false); return; }
    setSent(true);
    toast({ type: "success", title: t("auth.forgotPassword.success") });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-5 py-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]">
          <Mail className="size-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-[var(--color-fg)]">{t("auth.forgotPassword.sentTitle")}</h2>
          <p className="text-sm text-[var(--color-fg-muted)]">{t("auth.forgotPassword.sentDesc")}</p>
        </div>
        <Link to="/auth/login">
          <Button variant="outline">
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t("auth.forgotPassword.backToLogin")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl gradient-brand shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
          <KeyRound className="size-7 text-white" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
          {t("auth.forgotPassword.title")}
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t("auth.forgotPassword.subtitle")}
        </p>
      </div>

      {error && <Alert variant="error" onClose={() => setError("")}>{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.fields.email")}</Label>
          <InputIcon
            id="email"
            type="email"
            icon={Mail}
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {t("auth.forgotPassword.submit")}
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--color-fg-muted)]">
        <Link to="/auth/login" className="font-medium text-[var(--color-primary-soft)] hover:underline">
          {t("auth.forgotPassword.backToLogin")}
        </Link>
      </p>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email) { setError(t("auth.errors.required")); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.resend({ type: "signup", email });
    if (err) { setError(err.message); setLoading(false); return; }
    setResent(true);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
          <Mail className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
            {t("auth.verifyEmail.title")}
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xs mx-auto">
            {t("auth.verifyEmail.subtitle")}
          </p>
        </div>

        {resent ? (
          <Alert variant="success" className="w-full">{t("auth.verifyEmail.resent")}</Alert>
        ) : (
          <form onSubmit={handleResend} className="w-full space-y-4">
            {error && <Alert variant="error" onClose={() => setError("")}>{error}</Alert>}
            <div className="space-y-2 text-start">
              <Label htmlFor="resend-email">{t("auth.fields.email")}</Label>
              <InputIcon
                id="resend-email"
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
              {t("auth.verifyEmail.resend")}
            </Button>
          </form>
        )}

        <Link to="/auth/login" className="text-sm font-medium text-[var(--color-primary-soft)] hover:underline">
          {t("auth.verifyEmail.backToLogin")}
        </Link>
      </div>
    </div>
  );
}

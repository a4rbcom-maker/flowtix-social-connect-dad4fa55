import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Lock, ArrowLeft, LogIn } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { InputIcon, PasswordInputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

export function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError(t("auth.errors.required")); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message === "Invalid login credentials" ? t("auth.errors.invalidCredentials") : (err.message || t("auth.errors.invalidCredentials")));
      setLoading(false);
      return;
    }
    toast({ type: "success", title: t("auth.login.success") });
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl gradient-brand shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
          <LogIn className="size-7 text-white" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
          {t("auth.login.title")}
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t("auth.login.subtitle")}
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("auth.fields.password")}</Label>
            <Link to="/auth/forgot-password" className="text-xs font-medium text-[var(--color-primary-soft)] hover:underline">
              {t("auth.login.forgotPassword")}
            </Link>
          </div>
          <PasswordInputIcon
            id="password"
            icon={Lock}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {t("auth.login.submit")}
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--color-fg-muted)]">
        {t("auth.login.noAccount")}{" "}
        <Link to="/auth/register" className="font-semibold text-[var(--color-primary-soft)] hover:underline">
          {t("auth.login.signUp")}
        </Link>
      </p>
    </div>
  );
}

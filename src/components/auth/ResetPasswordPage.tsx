import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Lock, ArrowLeft, ShieldCheck, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { PasswordInputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!password || !confirmPassword) { setError(t("auth.errors.required")); return; }
    if (password.length < 8) { setError(t("auth.errors.passwordLength")); return; }
    if (password !== confirmPassword) { setError(t("auth.errors.passwordMismatch")); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setError(err.message); setLoading(false); return; }
    toast({ type: "success", title: t("auth.resetPassword.success") });
    navigate("/auth/login", { replace: true });
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl gradient-brand shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
          <ShieldCheck className="size-7 text-white" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
          {t("auth.resetPassword.title")}
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t("auth.resetPassword.subtitle")}
        </p>
      </div>

      {error && <Alert variant="error" onClose={() => setError("")}>{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.fields.newPassword")}</Label>
          <PasswordInputIcon
            id="password"
            icon={Lock}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("auth.fields.confirmPassword")}</Label>
          <PasswordInputIcon
            id="confirmPassword"
            icon={Check}
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {t("auth.resetPassword.submit")}
        </Button>
      </form>
    </div>
  );
}

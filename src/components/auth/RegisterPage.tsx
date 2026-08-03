import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Lock, User, ArrowLeft, UserPlus, Check, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { InputIcon, PasswordInputIcon } from "@/components/ui/input-icon";
import { Label } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";

export function RegisterPage() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [regEnabled, setRegEnabled] = useState<boolean | null>(null);

  useEffect(() => { (async () => {
    try {
      const { data } = await (supabase as any).rpc("is_registration_enabled");
      setRegEnabled(data === true);
    } catch { setRegEnabled(true); }
  })(); }, []);

  if (regEnabled === null) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin size-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" /></div>;

  if (!regEnabled) {
    return (
      <div className="space-y-6 text-center">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          <ArrowLeft className="size-4 rtl:rotate-180" />{t("auth.backHome")}
        </Link>
        <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-warning)_15%,transparent)]">
          <ShieldAlert className="size-10 text-[var(--color-warning)]" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">{t("auth.registrationClosed")}</h1>
        <p className="text-sm text-[var(--color-fg-muted)] max-w-sm mx-auto">{t("auth.registrationClosedDesc")}</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/auth/login">{t("auth.register.signIn")}</Link></Button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name || !email || !password || !confirmPassword) { setError(t("auth.errors.required")); return; }
    if (password.length < 8) { setError(t("auth.errors.passwordLength")); return; }
    if (password !== confirmPassword) { setError(t("auth.errors.passwordMismatch")); return; }
    if (!agreed) { setError(t("auth.errors.mustAgree")); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (err) { setError(err.message); setLoading(false); return; }
    toast({ type: "success", title: t("auth.register.success") });
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("auth.backHome")}
      </Link>

      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl gradient-brand shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
          <UserPlus className="size-7 text-white" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)]">
          {t("auth.register.title")}
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          {t("auth.register.subtitle")}
        </p>
      </div>

      {error && <Alert variant="error" onClose={() => setError("")}>{error}</Alert>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">{t("auth.fields.fullName")}</Label>
          <InputIcon
            id="name"
            icon={User}
            placeholder={t("auth.fields.fullNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
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
          <Label htmlFor="password">{t("auth.fields.password")}</Label>
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
        <Checkbox
          id="agree"
          label={t("auth.register.agree")}
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          {t("auth.register.submit")}
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--color-fg-muted)]">
        {t("auth.register.hasAccount")}{" "}
        <Link to="/auth/login" className="font-semibold text-[var(--color-primary-soft)] hover:underline">
          {t("auth.register.signIn")}
        </Link>
      </p>
    </div>
  );
}

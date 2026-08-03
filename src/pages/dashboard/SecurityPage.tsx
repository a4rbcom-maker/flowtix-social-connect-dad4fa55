import { useTranslation } from "react-i18next";
import { ShieldCheck, Smartphone, Monitor, Tablet, KeyRound, LogOut } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const sessions = [
  { id: "1", device: "Chrome — Windows", location: "Riyadh, SA", ip: "84.21.xxx.xx", current: true, icon: Monitor, lastActive: "Active now" },
  { id: "2", device: "Safari — iPhone 15", location: "Riyadh, SA", ip: "84.21.xxx.xx", current: false, icon: Smartphone, lastActive: "2h ago" },
  { id: "3", device: "Edge — Windows", location: "Jeddah, SA", ip: "92.40.xxx.xx", current: false, icon: Monitor, lastActive: "1d ago" },
  { id: "4", device: "Chrome — iPad", location: "Mecca, SA", ip: "78.93.xxx.xx", current: false, icon: Tablet, lastActive: "3d ago" },
];

export function SecurityPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.security.title")} description={t("pages.security.subtitle")} icon={ShieldCheck} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="text-center pt-6"><ShieldCheck className="mx-auto size-8 text-[var(--color-success)]" /><p className="mt-2 text-sm font-semibold text-[var(--color-fg)]">{t("pages.security.accountProtected")}</p></CardContent></Card>
        <Card><CardContent className="text-center pt-6"><KeyRound className="mx-auto size-8 text-[var(--color-primary)]" /><p className="mt-2 text-sm font-semibold text-[var(--color-fg)]">{t("pages.security.passwordStrong")}</p></CardContent></Card>
        <Card><CardContent className="text-center pt-6"><Smartphone className="mx-auto size-8 text-[var(--color-warning)]" /><p className="mt-2 text-sm font-semibold text-[var(--color-fg)]">{t("pages.security.enable2FA")}</p></CardContent></Card>
      </div>

      <Card hover="lift">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("pages.security.activeSessions")}</CardTitle>
          <Button variant="danger" size="sm"><LogOut className="size-3.5" />{t("pages.security.logoutAll")}</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {sessions.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-surface-2)]">
                <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)] shrink-0">
                  <Icon className="size-5 text-[var(--color-fg-muted)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--color-fg)]">{s.device}</p>
                    {s.current && <Badge variant="success">{t("pages.security.current")}</Badge>}
                  </div>
                  <p className="text-xs text-[var(--color-fg-subtle)]">{s.location} • {s.ip} • {s.lastActive}</p>
                </div>
                {!s.current && <Button variant="ghost" size="sm" className="shrink-0 text-[var(--color-error)]">{t("pages.security.revoke")}</Button>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card hover="lift">
        <CardHeader><CardTitle>{t("pages.security.changePassword")}</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2"><label className="text-sm font-medium text-[var(--color-fg)]">{t("pages.security.currentPassword")}</label><input type="password" className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3.5 text-sm focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] outline-none" placeholder="••••••••" /></div>
          <div className="space-y-2"><label className="text-sm font-medium text-[var(--color-fg)]">{t("pages.security.newPassword")}</label><input type="password" className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3.5 text-sm focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] outline-none" placeholder="••••••••" /></div>
          <div className="space-y-2"><label className="text-sm font-medium text-[var(--color-fg)]">{t("auth.fields.confirmPassword")}</label><input type="password" className="h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-3.5 text-sm focus-visible:border-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] outline-none" placeholder="••••••••" /></div>
          <Button>{t("pages.security.updatePassword")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

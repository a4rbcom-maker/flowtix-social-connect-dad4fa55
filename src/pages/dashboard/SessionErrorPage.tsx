import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Clock, WifiOff, ShieldAlert, CloudOff, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const errorTypes = {
  expired: { icon: Clock, color: "warning", titleKey: "sessionErrors.expired.title", descKey: "sessionErrors.expired.description" },
  lost: { icon: WifiOff, color: "error", titleKey: "sessionErrors.lost.title", descKey: "sessionErrors.lost.description" },
  auth: { icon: ShieldAlert, color: "error", titleKey: "sessionErrors.auth.title", descKey: "sessionErrors.auth.description" },
  network: { icon: CloudOff, color: "warning", titleKey: "sessionErrors.network.title", descKey: "sessionErrors.network.description" },
} as const;

export function SessionErrorPage({ type }: { type: keyof typeof errorTypes }) {
  const { t } = useTranslation();
  const config = errorTypes[type];
  const Icon = config.icon;
  const colorClass = config.color === "error" ? "text-[var(--color-error)]" : "text-[var(--color-warning)]";
  const bgClass = config.color === "error" ? "bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]" : "bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)]";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-5 py-10 text-center animate-[scale-in_0.4s_ease-out]">
          <div className={`flex size-20 items-center justify-center rounded-2xl ${bgClass}`}>
            <Icon className={`size-10 ${colorClass}`} />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-extrabold text-[var(--color-fg)]">{t(config.titleKey)}</h1>
            <p className="text-sm text-[var(--color-fg-muted)] max-w-xs mx-auto">{t(config.descKey)}</p>
          </div>
          <div className="flex flex-col gap-2 w-full sm:flex-row sm:justify-center">
            <Button variant="primary" onClick={() => window.location.reload()}>
              <RefreshCw className="size-4" />{t("sessionErrors.retry")}
            </Button>
            <Button asChild variant="outline">
              <Link to="/dashboard/facebook/sessions">
                <ArrowLeft className="size-4 rtl:rotate-180" />{t("sessions.backToSessions")}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

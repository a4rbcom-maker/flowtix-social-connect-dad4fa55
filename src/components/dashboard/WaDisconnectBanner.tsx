// Persistent inline banner shown at the top of the dashboard content whenever
// at least one WhatsApp session is `disconnected`. Together with the
// `useWaDisconnectAlerts` toast, this ensures the user is warned BEFORE they
// launch a bulk campaign on a dead session.
import { Link } from "@tanstack/react-router";
import { AlertTriangle, PlugZap } from "lucide-react";
import { useWaDisconnectAlerts } from "@/hooks/useWaDisconnectAlerts";

interface Props {
  lang: "ar" | "en";
}

export function WaDisconnectBanner({ lang }: Props) {
  const { disconnectedCount, lastReason } = useWaDisconnectAlerts(lang);
  if (disconnectedCount <= 0) return null;

  const isAr = lang === "ar";
  const title = isAr
    ? disconnectedCount === 1
      ? "جلسة واتساب غير متصلة"
      : `${disconnectedCount} جلسات واتساب غير متصلة`
    : disconnectedCount === 1
      ? "WhatsApp session disconnected"
      : `${disconnectedCount} WhatsApp sessions disconnected`;
  const hint = isAr
    ? "أعد الاقتران الآن قبل تشغيل أي حملة جماعية — الرسائل ستفشل بدون جلسة نشطة."
    : "Reconnect now before running any bulk campaign — messages will fail without an active session.";
  const cta = isAr ? "فتح صفحة الحسابات" : "Open accounts";

  return (
    <div
      role="alert"
      dir={isAr ? "rtl" : "ltr"}
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          {lastReason ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80" dir="ltr">
              {lastReason}
            </p>
          ) : null}
        </div>
      </div>
      <Link
        to="/dashboard/whatsapp/accounts"
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground shadow-sm transition hover:opacity-90"
      >
        <PlugZap className="h-4 w-4" />
        {cta}
      </Link>
    </div>
  );
}

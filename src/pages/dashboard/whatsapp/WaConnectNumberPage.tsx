import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams, useNavigate } from "react-router-dom";
import { QrCode, Smartphone, CheckCircle2, Loader2, RefreshCw, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWaSession, useWaSessionMutations } from "@/hooks/useWaSessions";

export function WaConnectNumberPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get("id");
  const { data: session, isLoading } = useWaSession(sessionId ?? undefined);
  const mutations = useWaSessionMutations();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
  const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";

  // Start WA session and poll QR
  useEffect(() => {
    if (!sessionId) return;
    let interval: any;
    let mounted = true;

    (async () => {
      try {
        await fetch(`${apiUrl}/wa/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch {}
      interval = setInterval(async () => {
        try {
          const r = await fetch(`${apiUrl}/wa/${sessionId}/qr`, { headers: { "X-API-Key": apiKey } });
          if (r.ok && mounted) { const { qr } = await r.json(); setQrDataUrl(qr); }
        } catch {}
      }, 3000);
    })();

    return () => { mounted = false; if (interval) clearInterval(interval); };
  }, [sessionId]);

  if (!sessionId) return <div className="p-6 text-center text-[var(--color-fg-muted)]">{t("wa.connect.noSession")}</div>;
  if (isLoading || !session) return <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div>;

  const isConnected = session.status === "connected";

  return (
    <div className="space-y-6">
      <PageHeader title={t("wa.connect.title")} description={t("wa.connect.subtitle", { name: session.name })} icon={QrCode} />
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-6 py-10">
            {isConnected ? (
              <>
                <div className="flex size-20 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[var(--color-success)]">
                  <CheckCircle2 className="size-10" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-bold">{t("wa.connect.connected")}</h3>
                  <p className="text-sm text-[var(--color-fg-muted)]">{session.push_name ?? session.phone_number ?? "—"}</p>
                  <Badge variant="success">{t("wa.sessions.status.connected")}</Badge>
                </div>
                <Button onClick={() => navigate(`/dashboard/whatsapp/sessions/${session.id}`)}>
                  {t("wa.connect.goToInbox")} <ArrowRight className="size-4 rtl:rotate-180" />
                </Button>
              </>
            ) : (
              <>
                <div className="flex size-20 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-primary)]">
                  <Smartphone className="size-10" />
                </div>
                <div className="text-center space-y-1 max-w-sm">
                  <h3 className="text-lg font-bold">{t("wa.connect.scanQR")}</h3>
                  <p className="text-sm text-[var(--color-fg-muted)]">{t("wa.connect.qrInstructions")}</p>
                </div>
                <div className="flex size-64 items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="QR Code" className="size-56 rounded-xl" />
                  ) : session.status === "qr_ready" || session.status === "authenticating" ? (
                    <QrCode className="size-40 text-[var(--color-fg-subtle)] opacity-50" />
                  ) : (
                    <Loader2 className="size-8 animate-spin text-[var(--color-primary)]" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="warning"><Loader2 className="size-3 animate-spin" />{t(`wa.sessions.status.${session.status}`)}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => mutations.requestQR.mutate(session.id)}>
                    <RefreshCw className="size-3.5" /> {t("wa.connect.refreshQR")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

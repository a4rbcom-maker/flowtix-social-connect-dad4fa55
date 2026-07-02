import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Timer, Layers, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getExtractionQuotaStatus } from "@/lib/fb-bot.functions";
import { useI18n } from "@/lib/i18n";

export function ExtractionQuotaBanner() {
  const { lang } = useI18n();
  const fetchStatus = useServerFn(getExtractionQuotaStatus);
  const { data } = useQuery({
    queryKey: ["extraction-quota"],
    queryFn: () => fetchStatus(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const t =
    lang === "ar"
      ? {
          title: "حدود الاستخراج الآمن",
          desc: "لضمان أعلى جودة استخراج والحفاظ على أمان حسابك على فيسبوك، نطبّق حدوداً مدروسة على عمليات الاستخراج.",
          concurrent: "مهام نشطة الآن",
          daily: "الاستخدام اليومي",
          cooldown: "الفاصل الزمني بين المهام",
          cooldownReady: "جاهز الآن",
          cooldownRemain: (s: number) => `يتبقى ${s} ث`,
          of: "من",
        }
      : {
          title: "Safe extraction limits",
          desc: "To keep extraction quality high and your Facebook account safe, sensible limits apply to extraction jobs.",
          concurrent: "Active now",
          daily: "Daily usage",
          cooldown: "Cooldown between jobs",
          cooldownReady: "Ready",
          cooldownRemain: (s: number) => `${s}s left`,
          of: "of",
        };

  const active = data?.activeCount ?? 0;
  const maxC = data?.maxConcurrent ?? 1;
  const used = data?.usedToday ?? 0;
  const cap = data?.dailyCap ?? 25;
  const cool = data?.cooldownRemaining ?? 0;

  return (
    <Card className="border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{t.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.desc}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2 text-xs">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{t.concurrent}:</span>
              <span className="font-semibold">
                {active} {t.of} {maxC}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2 text-xs">
              <Gauge className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{t.daily}:</span>
              <span className="font-semibold">
                {used} {t.of} {cap}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2 text-xs">
              <Timer className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{t.cooldown}:</span>
              <span className="font-semibold">
                {cool > 0 ? t.cooldownRemain(cool) : t.cooldownReady}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

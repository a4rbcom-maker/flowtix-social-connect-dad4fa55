import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const events = [
  { key: "extractionComplete", label: "pages.notifications.events.extractionComplete", enabled: true },
  { key: "taskFailed", label: "pages.notifications.events.taskFailed", enabled: true },
  { key: "exportReady", label: "pages.notifications.events.exportReady", enabled: true },
  { key: "subscriptionRenewal", label: "pages.notifications.events.subscriptionRenewal", enabled: true },
  { key: "securityAlert", label: "pages.notifications.events.securityAlert", enabled: true },
];

export function NotificationsPage() {
  const { t } = useTranslation();
  const [eventStates, setEventStates] = useState(() => {
    const m: Record<string, boolean> = {};
    events.forEach((e) => { m[e.key] = e.enabled; });
    return m;
  });

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader title={t("pages.notifications.title")} description={t("pages.notifications.subtitle")} icon={Bell} />

      <Card hover="lift">
        <CardHeader><CardTitle>{t("pages.notifications.eventsTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {events.map((ev) => (
            <div key={ev.key} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
              <span className="text-sm font-medium text-[var(--color-fg)]">{t(ev.label)}</span>
              <ToggleSwitch checked={eventStates[ev.key]} onChange={(v) => setEventStates((p) => ({ ...p, [ev.key]: v }))} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-3)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

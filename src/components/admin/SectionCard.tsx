import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function SectionCard({
  number,
  icon: Icon,
  title,
  children,
}: {
  number: number;
  icon: LucideIcon;
  title: string;
  accent?: "primary";
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center gap-3 pb-3">
        <span className="flex size-8 items-center justify-center rounded-xl bg-gradient-brand text-xs font-bold text-white shadow-[0_4px_12px_-4px_rgba(109,94,252,0.5)]">
          {number}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-[var(--color-primary)]" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      {children}
    </Card>
  );
}

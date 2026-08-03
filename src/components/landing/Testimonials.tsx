import { useTranslation } from "react-i18next";
import { Quote, Star } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Card } from "@/components/ui/card";

export function Testimonials() {
  const { t, i18n } = useTranslation();

  const items = (t("testimonials.items", { returnObjects: true }) as Array<{
    quote: string;
    name: string;
    role: string;
  }>) ?? [];

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("");

  return (
    <Section className="bg-[var(--color-bg-elevated)]">
      <div className="container-page">
        <SectionHeading
          badge={t("testimonials.badge")}
          title={t("testimonials.title")}
          subtitle={t("testimonials.subtitle")}
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {items.map((item, i) => (
            <Card key={i} className="card-hover relative overflow-hidden p-7">
              <Quote className="absolute -end-2 -top-2 size-20 text-[var(--color-surface-3)]" aria-hidden />
              <div className="relative flex gap-1">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} className="size-4 fill-[var(--color-warning)] text-[var(--color-warning)]" aria-hidden />
                ))}
              </div>
              <blockquote className="relative mt-4 text-base leading-relaxed text-[var(--color-fg)]">
                {i18n.dir() === "rtl" ? `"${item.quote}"` : `"${item.quote}"`}
              </blockquote>
              <div className="relative mt-6 flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-full gradient-brand text-sm font-bold text-white">
                  {initials(item.name)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-[var(--color-fg-muted)]">{item.role}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}

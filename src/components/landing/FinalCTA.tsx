import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden py-16 sm:py-24 md:py-32">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 py-14 text-center sm:rounded-[2.5rem] sm:px-12 sm:py-20">
          <div className="pointer-events-none absolute inset-0 bg-radial-glow" aria-hidden />
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.15] [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]" aria-hidden />
          <div className="pointer-events-none absolute -top-16 start-1/2 size-56 -translate-x-1/2 rounded-full bg-[var(--color-primary)] opacity-15 blur-[80px] sm:-top-20 sm:size-80 sm:blur-[120px]" aria-hidden />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
              {t("finalCta.title")}
            </h2>
            <p className="mt-4 text-base text-[var(--color-fg-muted)] text-pretty sm:mt-5 sm:text-lg">
              {t("finalCta.subtitle")}
            </p>
            <div className="mt-7 flex justify-center sm:mt-9">
              <Button asChild size="lg" className="group w-full sm:w-auto">
                <Link to="/auth/register">
                  {t("finalCta.cta")}
                  <ArrowRight className="transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-[var(--color-fg-subtle)] sm:mt-5 sm:text-sm">{t("finalCta.note")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

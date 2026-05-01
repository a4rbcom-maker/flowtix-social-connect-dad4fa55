import { useI18n } from "@/lib/i18n";

export function HowItWorksSection() {
  const { t, dir } = useI18n();

  return (
    <section id="how-it-works" dir={dir} className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.howItWorks.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.howItWorks.subtitle}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {t.howItWorks.steps.map((step, i) => (
            <div key={i} className="relative text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-600 text-2xl font-bold text-white shadow-lg shadow-primary/25">
                {i + 1}
              </div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
              {i < 2 && (
                <div className="absolute top-8 hidden w-full md:block" style={{ [dir === "rtl" ? "left" : "right"]: "-50%" }}>
                  <div className="h-0.5 w-full bg-gradient-to-r from-primary/50 to-transparent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

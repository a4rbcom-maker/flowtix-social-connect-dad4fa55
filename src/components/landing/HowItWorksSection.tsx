import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";

export function HowItWorksSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <section id="how-it-works" dir={dir} className="py-20 md:py-28 bg-accent/30">
      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.howItWorks.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.howItWorks.subtitle}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {t.howItWorks.steps.map((step, i) => (
            <div
              key={i}
              className={`relative text-center transition-all duration-600 ${
                isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: isInView ? `${200 + i * 200}ms` : "0ms" }}
            >
              <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-600 text-2xl font-bold text-white shadow-lg shadow-primary/25 transition-all duration-300 hover:scale-110 ${
                isInView ? "animate-pulse-glow" : ""
              }`}>
                {i + 1}
              </div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
              {i < 2 && (
                <div className="absolute top-8 hidden w-full md:block" style={{ [dir === "rtl" ? "left" : "right"]: "-50%" }}>
                  <div
                    className={`h-0.5 w-full bg-gradient-to-r from-primary/50 to-transparent transition-all duration-1000 ${
                      isInView ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
                    }`}
                    style={{ transitionDelay: isInView ? `${600 + i * 300}ms` : "0ms", transformOrigin: dir === "rtl" ? "right" : "left" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

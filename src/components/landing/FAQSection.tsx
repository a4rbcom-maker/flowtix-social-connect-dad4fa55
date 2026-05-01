import { useI18n } from "@/lib/i18n";
import { useState } from "react";
import { useInView } from "@/hooks/use-in-view";

export function FAQSection() {
  const { t, dir } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { ref, isInView } = useInView();

  return (
    <section id="faq" dir={dir} className="py-20 md:py-28 bg-accent/30">
      <div ref={ref} className="mx-auto max-w-3xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.faq.title}</h2>
        </div>

        <div className="space-y-3">
          {t.faq.items.map((item, i) => (
            <div
              key={i}
              className={`rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all duration-500 hover:border-primary/20 ${
                openIndex === i ? "shadow-lg shadow-primary/5 border-primary/30" : ""
              } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
              style={{ transitionDelay: isInView ? `${100 + i * 80}ms` : "0ms" }}
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-start"
              >
                <span className="font-medium text-foreground">{item.q}</span>
                <svg
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${openIndex === i ? "rotate-180" : ""}`}
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div
                className="grid transition-all duration-300 ease-in-out"
                style={{ gridTemplateRows: openIndex === i ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <div className="px-6 pb-4 text-sm leading-relaxed text-muted-foreground">
                    {item.a}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useI18n } from "@/lib/i18n";
import { useState } from "react";
import { useInView } from "@/hooks/use-in-view";

export function FAQSection() {
  const { t, dir } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { ref, isInView } = useInView();

  return (
    <section id="faq" dir={dir} className="py-12 md:py-16 bg-accent/30">
      <div ref={ref} className="mx-auto max-w-3xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            {dir === "rtl" ? "❓ أسئلة شائعة" : "❓ FAQ"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.faq.title}</h2>
        </div>

        <div className="space-y-3">
          {t.faq.items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={i}
                className={`rounded-xl border bg-card/80 backdrop-blur-sm transition-all duration-500 ${
                  isOpen
                    ? "shadow-lg shadow-primary/5 border-primary/30 bg-card"
                    : "border-border/50 hover:border-primary/20 hover:shadow-md"
                } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
                style={{ transitionDelay: isInView ? `${100 + i * 80}ms` : "0ms" }}
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-5 text-start group"
                >
                  <span className={`font-medium transition-colors duration-200 ${isOpen ? "text-primary" : "text-foreground group-hover:text-primary"}`}>
                    {item.q}
                  </span>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                    isOpen ? "bg-primary text-primary-foreground rotate-180" : "bg-accent text-muted-foreground"
                  }`}>
                    <svg
                      className="h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>
                <div
                  className="grid transition-all duration-400 ease-in-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground border-t border-border/30 pt-4 mx-6">
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

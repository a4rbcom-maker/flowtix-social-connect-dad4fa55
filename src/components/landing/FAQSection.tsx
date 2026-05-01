import { useI18n } from "@/lib/i18n";
import { useState } from "react";

export function FAQSection() {
  const { t, dir } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" dir={dir} className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.faq.title}</h2>
        </div>

        <div className="space-y-3">
          {t.faq.items.map((item, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between px-6 py-4 text-start"
              >
                <span className="font-medium text-foreground">{item.q}</span>
                <svg
                  className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${openIndex === i ? "rotate-180" : ""}`}
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {openIndex === i && (
                <div className="px-6 pb-4 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

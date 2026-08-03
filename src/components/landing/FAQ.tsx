import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const faqKeys = ["secure", "free", "setup", "languages", "support", "cancel"] as const;

const faqContent: Record<string, { q: { ar: string; en: string }; a: { ar: string; en: string } }> = {
  secure: {
    q: { ar: "هل بياناتي آمنة على المنصة؟", en: "Is my data secure on the platform?" },
    a: {
      ar: "نعم، نستخدم تشفير AES-256 لجميع البيانات ونمتثل لمعايير GDPR. أمن بياناتك أولويتنا القصوى.",
      en: "Yes, we use AES-256 encryption for all data and are GDPR compliant. Your data security is our top priority.",
    },
  },
  free: {
    q: { ar: "هل توجد فترة تجريبية مجانية؟", en: "Is there a free trial?" },
    a: {
      ar: "نعم، نقدم خطة مجانية محدودة بالإضافة إلى فترة تجريبية 14 يوماً على جميع الباقات المدفوعة دون الحاجة لبطاقة ائتمان.",
      en: "Yes, we offer a limited free plan plus a 14-day trial on all paid plans, no credit card required.",
    },
  },
  setup: {
    q: { ar: "كم يستغرق الإعداد؟", en: "How long does setup take?" },
    a: {
      ar: "الإعداد يستغرق دقائق فقط. اربط حسابك، اضبط مهامك، وابدأ الأتمتة فوراً دون أي معرفة تقنية.",
      en: "Setup takes just minutes. Connect your account, configure your tasks, and start automating instantly — no technical knowledge needed.",
    },
  },
  languages: {
    q: { ar: "هل تدعمون اللغة العربية؟", en: "Do you support Arabic?" },
    a: {
      ar: "تدعم المنصة العربية والإنجليزية بالكامل مع دعم RTL و LTR وتحويل سلس بين اللغتين.",
      en: "The platform fully supports Arabic and English with complete RTL and LTR support and seamless language switching.",
    },
  },
  support: {
    q: { ar: "ما نوع الدعم المتوفر؟", en: "What kind of support is available?" },
    a: {
      ar: "نوفر دعماً عبر البريد للخطة المبتدئة ودعماً ذا أولوية للخطة الاحترافية ومدير حساب مخصص للخطة المؤسسية.",
      en: "We offer email support for Starter, priority support for Pro, and a dedicated account manager for Enterprise.",
    },
  },
  cancel: {
    q: { ar: "هل يمكنني الإلغاء في أي وقت؟", en: "Can I cancel anytime?" },
    a: {
      ar: "يمكنك الإلغاء في أي وقت من لوحة التحكم دون أي رسوم إضافية. لا توجد عقود ملزمة.",
      en: "You can cancel anytime from your dashboard with no extra fees. There are no binding contracts.",
    },
  },
};

export function FAQ() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<number | null>(0);
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";

  return (
    <Section id="faq" className="scroll-mt-20 bg-[var(--color-bg-elevated)]">
      <div className="container-page">
        <SectionHeading
          badge={t("faq.badge")}
          title={t("faq.title")}
          subtitle={t("faq.subtitle")}
        />

        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {faqKeys.map((key, i) => {
            const isOpen = open === i;
            const item = faqContent[key];
            return (
              <div
                key={key}
                className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[var(--color-border-strong)]"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-start"
                >
                  <span className="text-base font-semibold">{item.q[lang]}</span>
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] transition-transform duration-300",
                      isOpen && "rotate-45 text-[var(--color-primary-soft)]",
                    )}
                  >
                    <Plus className="size-4" aria-hidden />
                  </span>
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-out",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <p className="px-6 pb-5 text-sm leading-relaxed text-[var(--color-fg-muted)]">
                      {item.a[lang]}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

import { useTranslation } from "react-i18next";

const companies = ["Nexora", "Quantix", "Vertex", "Lumen", "Cobalt", "Stratos", "Aurea", "Pinnacle"];

export function TrustedBy() {
  const { t } = useTranslation();

  return (
    <section className="border-y border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-12">
      <div className="container-page">
        <p className="text-center text-sm font-medium text-[var(--color-fg-subtle)]">
          {t("trusted.title")}
        </p>
        <div className="relative mt-8 overflow-hidden mask-fade-x">
          <div className="flex w-max animate-[marquee_32s_linear_infinite] items-center gap-12">
            {[...companies, ...companies].map((name, i) => (
              <span
                key={i}
                className="text-xl font-bold tracking-tight text-[var(--color-fg-muted)]/60 transition-colors hover:text-[var(--color-fg)] sm:text-2xl"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

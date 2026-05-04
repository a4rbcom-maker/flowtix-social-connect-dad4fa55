import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";

const icons = [
  <svg key="fb" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>,
  <svg key="wa" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  <svg key="ai" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3H5a3 3 0 0 0 0 6h1a3 3 0 0 0 3 3v1a3 3 0 0 0 6 0v-1a3 3 0 0 0 3-3h1a3 3 0 0 0 0-6h-1a3 3 0 0 0-3-3V5a3 3 0 0 0-3-3z"/><path d="M9 12h.01"/><path d="M15 12h.01"/></svg>,
  <svg key="bulk" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>,
  <svg key="bg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  <svg key="dash" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>,
];

function FeatureCard({ item, icon, index, isInView }: {
  item: { title: string; desc: string };
  icon: React.ReactNode;
  index: number;
  isInView: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-500 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1 ${
        isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: isInView ? `${index * 80}ms` : "0ms" }}
    >
      {/* Top gradient accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Subtle hover glow */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-48 rounded-full bg-primary/15 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

      <div className="relative p-8">
        <div className="flex items-start justify-between mb-6">
          {/* Icon */}
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/15 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary group-hover:scale-110 transition-all duration-300">
              {icon}
            </div>
          </div>
          {/* Number */}
          <span className="text-3xl font-bold text-muted-foreground/15 group-hover:text-primary/30 transition-colors duration-300 tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <h3 className="mb-3 text-lg font-bold text-foreground group-hover:text-primary transition-colors duration-300">
          {item.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>

        {/* Footer divider */}
        <div className="mt-6 pt-6 border-t border-border/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-primary/70 group-hover:text-primary transition-colors">
            متاح الآن
          </span>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <section id="features" dir={dir} className="relative py-12 md:py-16">
      {/* Subtle dotted background */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div ref={ref} className="relative mx-auto max-w-7xl px-4">
        <div className={`mb-10 max-w-2xl mx-auto text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {dir === "rtl" ? "مميزات المنصة" : "Platform Features"}
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
            {t.features.title}
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">{t.features.subtitle}</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((item, i) => (
            <FeatureCard key={i} item={item} icon={icons[i]} index={i} isInView={isInView} />
          ))}
        </div>
      </div>
    </section>
  );
}

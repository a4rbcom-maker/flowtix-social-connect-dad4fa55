import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";
import { useState } from "react";

const icons = [
  <svg key="fb" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>,
  <svg key="wa" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  <svg key="ai" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M12 2v2"/><path d="M12 20v2"/></svg>,
  <svg key="bulk" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>,
  <svg key="bg" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/><circle cx="12" cy="12" r="10"/></svg>,
  <svg key="dash" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>,
];

function FeatureCard({ item, icon, index, isInView }: {
  item: { title: string; desc: string };
  icon: React.ReactNode;
  index: number;
  isInView: boolean;
}) {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hovered, setHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative rounded-2xl p-[1px] transition-all duration-700 ease-out ${
        isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
      }`}
      style={{
        transitionDelay: isInView ? `${120 + index * 90}ms` : "0ms",
        background: hovered
          ? `radial-gradient(220px circle at ${pos.x}% ${pos.y}%, oklch(0.62 0.27 295 / 0.6), oklch(0.92 0.02 295 / 0.4) 60%)`
          : "linear-gradient(180deg, oklch(0.92 0.02 295 / 0.5), oklch(0.92 0.02 295 / 0.15))",
      }}
    >
      <div
        className="relative h-full rounded-2xl bg-card/95 backdrop-blur-xl p-7 overflow-hidden transition-transform duration-500 group-hover:-translate-y-1"
      >
        {/* Spotlight glow following cursor */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: `radial-gradient(400px circle at ${pos.x}% ${pos.y}%, oklch(0.62 0.27 295 / 0.08), transparent 50%)`,
          }}
        />

        {/* Decorative corner gradient */}
        <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-gradient-to-br from-primary/20 to-transparent blur-2xl opacity-60 transition-opacity duration-500 group-hover:opacity-100" />

        {/* Number badge */}
        <div className="absolute top-5 left-5 text-[11px] font-mono font-semibold tracking-wider text-muted-foreground/40 group-hover:text-primary/60 transition-colors duration-300">
          0{index + 1}
        </div>

        {/* Icon container */}
        <div className="relative mb-6 mt-4">
          <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30 transition-all duration-500 group-hover:shadow-primary/50 group-hover:scale-110 group-hover:rotate-3">
            {icon}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>
          {/* Icon ring pulse */}
          <div className="absolute inset-0 h-14 w-14 rounded-2xl border-2 border-primary/30 opacity-0 group-hover:opacity-100 group-hover:scale-150 transition-all duration-700" />
        </div>

        <h3 className="mb-3 text-xl font-bold text-foreground transition-colors duration-300 group-hover:text-primary">
          {item.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>

        {/* Bottom indicator with arrow */}
        <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500">
          <span>اعرف المزيد</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180">
            <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <section id="features" dir={dir} className="relative py-24 md:py-32 overflow-hidden">
      {/* Background ambience */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/10 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <div ref={ref} className="relative mx-auto max-w-7xl px-4">
        <div className={`mb-20 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-sm px-5 py-2 text-xs font-semibold text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {dir === "rtl" ? "مميزات المنصة" : "Platform Features"}
          </div>
          <h2 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">
            {t.features.title}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">{t.features.subtitle}</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {t.features.items.map((item, i) => (
            <FeatureCard key={i} item={item} icon={icons[i]} index={i} isInView={isInView} />
          ))}
        </div>
      </div>
    </section>
  );
}

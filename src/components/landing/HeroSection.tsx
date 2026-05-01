import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

function AnimatedCounter({ target, suffix = "" }: { target: string; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const num = parseInt(target.replace(/[^0-9]/g, ""), 10);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let start = 0;
          const duration = 1500;
          const startTime = performance.now();
          const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            start = Math.floor(eased * num);
            setCount(start);
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
          observer.unobserve(el);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [num]);

  const prefix = target.startsWith("+") ? "+" : "";
  return (
    <div ref={ref} className="text-3xl font-bold text-primary md:text-4xl">
      {prefix}{count}{suffix}
    </div>
  );
}

export function HeroSection() {
  const { t, dir } = useI18n();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section dir={dir} className="relative overflow-hidden pt-24 pb-20 md:pt-32 md:pb-28">
      {/* Animated floating orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-float absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="animate-float-reverse absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-blue-500/10 blur-[100px] delay-200" />
        <div className="animate-float-slow absolute bottom-1/4 left-1/4 h-48 w-48 rounded-full bg-violet-500/10 blur-[80px] delay-400" />
      </div>

      {/* Decorative particles */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-float absolute top-[20%] left-[10%] h-2 w-2 rounded-full bg-primary/30 delay-100" />
        <div className="animate-float-reverse absolute top-[30%] right-[15%] h-1.5 w-1.5 rounded-full bg-blue-500/30 delay-300" />
        <div className="animate-float absolute top-[60%] left-[80%] h-2.5 w-2.5 rounded-full bg-primary/20 delay-500" />
        <div className="animate-float-reverse absolute top-[70%] left-[20%] h-1 w-1 rounded-full bg-violet-500/30 delay-200" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 text-center">
        {/* Badge with shimmer */}
        <div
          className={`mb-6 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary transition-all duration-700 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <span className="relative">
            <span className="animate-shimmer bg-gradient-to-r from-primary via-blue-500 to-primary bg-clip-text text-transparent font-medium">
              {t.hero.badge}
            </span>
          </span>
        </div>

        {/* Title with staggered animation */}
        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-foreground md:text-6xl lg:text-7xl">
          <span
            className={`inline-block transition-all duration-700 delay-100 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            {t.hero.title1}
          </span>
          <br />
          <span
            className={`inline-block bg-gradient-to-r from-primary via-blue-500 to-violet-500 bg-clip-text text-transparent animate-gradient-shift transition-all duration-700 delay-200 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            {t.hero.title2}
          </span>
          <br />
          <span
            className={`inline-block transition-all duration-700 delay-300 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            {t.hero.title3}
          </span>
        </h1>

        <p
          className={`mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl transition-all duration-700 delay-400 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          {t.hero.desc}
        </p>

        <div
          className={`mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row transition-all duration-700 delay-500 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <Link
            to="/login"
            className="group relative rounded-xl bg-gradient-to-r from-primary to-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition-all duration-300 hover:shadow-xl hover:shadow-primary/40 hover:scale-105 hover:-translate-y-0.5"
          >
            <span className="relative z-10">{t.hero.cta}</span>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-600 to-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          </Link>
          <a
            href="#features"
            className="rounded-xl border border-border px-8 py-3.5 text-base font-semibold text-foreground transition-all duration-300 hover:bg-accent hover:scale-105 hover:border-primary/30 hover:shadow-md"
          >
            {t.hero.ctaSecondary}
          </a>
        </div>

        {/* Stats card */}
        <div
          className={`mx-auto mt-16 max-w-3xl rounded-2xl border border-border/50 bg-card/80 p-1 shadow-2xl shadow-primary/5 backdrop-blur-sm transition-all duration-1000 delay-600 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"
          }`}
        >
          <div className="rounded-xl bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5 p-8 md:p-12">
            <div className="grid grid-cols-3 gap-8 text-center">
              <div className="group">
                <AnimatedCounter target="+2000" suffix="" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors group-hover:text-foreground">
                  {dir === "rtl" ? "مستخدم نشط" : "Active Users"}
                </div>
              </div>
              <div className="group">
                <AnimatedCounter target="+50000" suffix="" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors group-hover:text-foreground">
                  {dir === "rtl" ? "رسالة يومياً" : "Messages/Day"}
                </div>
              </div>
              <div className="group">
                <AnimatedCounter target="99" suffix="%" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors group-hover:text-foreground">
                  {dir === "rtl" ? "وقت التشغيل" : "Uptime"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

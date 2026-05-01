import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMouseParallax, useInView } from "@/hooks/use-in-view";

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
          const duration = 1500;
          const startTime = performance.now();
          const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * num));
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
    <div ref={ref} className="text-3xl font-bold text-primary md:text-4xl tabular-nums">
      {prefix}{count.toLocaleString()}{suffix}
    </div>
  );
}

function CtaButtons({ mounted, t }: { mounted: boolean; t: any }) {
  const { ref, isInView } = useInView({ threshold: 0.3 });

  return (
    <div
      ref={ref}
      className={`mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row transition-all duration-700 delay-500 ${
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
    >
      <Link
        to="/login"
        className="group relative overflow-hidden rounded-xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-sm shadow-primary/10 transition-all duration-500 ease-out hover:shadow-md hover:shadow-primary/20 hover:scale-[1.02] hover:-translate-y-0.5 active:scale-[0.98] active:shadow-sm"
      >
        <span className="relative z-10 flex items-center gap-2">
          {t.hero.cta}
          <svg
            className="h-4 w-4 transition-transform duration-500 ease-out group-hover:translate-x-1 group-active:translate-x-0.5"
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
          </svg>
        </span>
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />
      </Link>

      <a
        href="#features"
        className="group rounded-xl border border-border px-8 py-3.5 text-base font-semibold text-foreground transition-all duration-500 ease-out hover:bg-accent/60 hover:border-primary/15 hover:-translate-y-0.5 active:scale-[0.98] active:bg-accent/80"
      >
        <span className="flex items-center gap-2">
          {t.hero.ctaSecondary}
          <svg
            className="h-4 w-4 transition-transform duration-500 ease-out group-hover:translate-y-0.5 group-active:translate-y-0"
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
          </svg>
        </span>
      </a>
    </div>
  );
}

export function HeroSection() {
  const { t, dir } = useI18n();
  const [mounted, setMounted] = useState(false);
  const mouse = useMouseParallax(0.008);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section dir={dir} className="relative overflow-hidden pt-28 pb-20 md:pt-36 md:pb-28">
      {/* Soft background orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="animate-float-slow absolute top-1/4 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/6 blur-[160px]"
          style={{ transform: `translate(${mouse.x * 1.5}px, ${mouse.y * 1.5}px)` }}
        />
        <div
          className="animate-float-slow absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-violet-300/5 blur-[140px]"
          style={{ transform: `translate(${mouse.x * -1}px, ${mouse.y * -1}px)` }}
        />
        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: "radial-gradient(circle, oklch(0.55 0.15 270) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }} />
      </div>

      {/* Gentle floating dots */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-float-slow absolute top-[15%] left-[8%] h-1.5 w-1.5 rounded-full bg-primary/15" />
        <div className="animate-float-slow absolute top-[25%] right-[12%] h-1 w-1 rounded-full bg-violet-400/15 delay-500" />
        <div className="animate-float-slow absolute top-[55%] left-[85%] h-2 w-2 rounded-full bg-primary/10 delay-300" />
        <div className="animate-float-slow absolute top-[65%] left-[15%] h-1 w-1 rounded-full bg-violet-400/12 delay-700" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 text-center">
        {/* Badge */}
        <div
          className={`mb-8 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-5 py-2 text-sm text-primary transition-all duration-700 ${
            mounted ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95"
          }`}
        >
          <span className="font-semibold text-primary">
            {t.hero.badge}
          </span>
        </div>

        {/* Title */}
        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-foreground md:text-6xl lg:text-7xl">
          <span
            className={`inline-block transition-all duration-700 delay-100 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {t.hero.title1}
          </span>
          <br />
          <span
            className={`inline-block gradient-text-animated transition-all duration-700 delay-200 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {t.hero.title2}
          </span>
          <br />
          <span
            className={`inline-block transition-all duration-700 delay-300 ${
              mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            {t.hero.title3}
          </span>
        </h1>

        <p
          className={`mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl transition-all duration-700 delay-400 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          {t.hero.desc}
        </p>

        {/* CTAs */}
        <CtaButtons mounted={mounted} t={t} />

        {/* Stats */}
        <div
          className={`mx-auto mt-16 max-w-3xl rounded-2xl glass-card p-1 shadow-lg shadow-black/5 transition-all duration-1000 delay-600 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
        >
          <div className="rounded-xl bg-gradient-to-br from-primary/3 via-transparent to-violet-400/3 p-8 md:p-12">
            <div className="grid grid-cols-3 gap-8 text-center">
              <div className="group cursor-default">
                <AnimatedCounter target="+2000" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors duration-300 group-hover:text-foreground">
                  {dir === "rtl" ? "مستخدم نشط" : "Active Users"}
                </div>
              </div>
              <div className="group cursor-default">
                <AnimatedCounter target="+50000" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors duration-300 group-hover:text-foreground">
                  {dir === "rtl" ? "رسالة يومياً" : "Messages/Day"}
                </div>
              </div>
              <div className="group cursor-default">
                <AnimatedCounter target="99" suffix="%" />
                <div className="mt-1 text-xs text-muted-foreground md:text-sm transition-colors duration-300 group-hover:text-foreground">
                  {dir === "rtl" ? "وقت التشغيل" : "Uptime"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chat mockup */}
        <div
          className={`mx-auto mt-12 max-w-2xl transition-all duration-1000 delay-700 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
        >
          <div className="relative">
            {/* Floating badges - gentle float */}
            <div className="animate-float-slow absolute -top-4 -right-2 md:-right-8 z-10 rounded-xl glass-card px-4 py-2.5 shadow-md">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-400" />
                <span className="text-xs font-medium text-foreground">{dir === "rtl" ? "مباشر" : "Live"}</span>
                <span className="text-xs text-muted-foreground">• 234 {dir === "rtl" ? "متصل" : "online"}</span>
              </div>
            </div>
            <div className="animate-float-slow absolute -bottom-3 -left-2 md:-left-8 z-10 rounded-xl glass-card px-4 py-2.5 shadow-md delay-500">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
                <span className="text-xs font-medium text-foreground">1,247 {dir === "rtl" ? "رسالة اليوم" : "sent today"}</span>
              </div>
            </div>

            {/* Main mockup */}
            <div className="rounded-2xl glass-card overflow-hidden shadow-lg shadow-black/5">
              <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3 bg-accent/20">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-300" />
                  <div className="h-3 w-3 rounded-full bg-yellow-300" />
                  <div className="h-3 w-3 rounded-full bg-green-300" />
                </div>
                <div className="mx-auto text-xs text-muted-foreground font-medium">flowtixtools.com</div>
              </div>
              <div className="p-4 md:p-6 space-y-3">
                <div className="flex gap-3 items-start">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                    <svg className="h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </div>
                  <div className="rounded-xl bg-accent/40 px-4 py-2.5 max-w-[75%]">
                    <p className="text-sm text-foreground">{dir === "rtl" ? "مرحباً، عايز أعرف سعر المنتج ده" : "Hi, I want to know the price of this product"}</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start justify-end">
                  <div className="rounded-xl bg-primary/5 px-4 py-2.5 max-w-[75%]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <svg className="h-3 w-3 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/></svg>
                      <span className="text-[10px] text-primary font-semibold">AI Bot</span>
                    </div>
                    <p className="text-sm text-foreground">{dir === "rtl" ? "أهلاً! 🎉 عندنا 3 باقات تناسبك..." : "Hello! 🎉 We have 3 plans for you..."}</p>
                  </div>
                  <div className="h-8 w-8 shrink-0 rounded-full bg-primary flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/></svg>
                  </div>
                </div>
                {/* Typing dots */}
                <div className="flex gap-3 items-start justify-end">
                  <div className="rounded-xl bg-primary/5 px-4 py-3">
                    <div className="flex gap-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce-subtle" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce-subtle delay-100" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/30 animate-bounce-subtle delay-200" />
                    </div>
                  </div>
                  <div className="h-8 w-8 shrink-0 rounded-full bg-primary flex items-center justify-center">
                    <svg className="h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className={`mt-12 transition-all duration-1000 delay-800 ${mounted ? "opacity-100" : "opacity-0"}`}>
          <div className="inline-flex flex-col items-center gap-1 text-muted-foreground/40">
            <span className="text-xs">{dir === "rtl" ? "اسحب للأسفل" : "Scroll down"}</span>
            <svg className="h-4 w-4 animate-bounce-subtle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

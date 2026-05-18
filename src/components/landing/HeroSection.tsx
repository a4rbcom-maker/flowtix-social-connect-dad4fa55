import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMouseParallax, useInView, useScrollParallax } from "@/hooks/use-in-view";

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
      <Link to="/login" className="btn-luxury-base btn-luxury group text-base">
        <span>{t.hero.cta}</span>
        <svg
          className="h-4 w-4 transition-transform duration-500 ease-out group-hover:translate-x-1"
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
        </svg>
      </Link>

      <a href="#features" className="btn-luxury-base btn-luxury-outline group text-base">
        <span>{t.hero.ctaSecondary}</span>
        <svg
          className="h-4 w-4 transition-transform duration-500 ease-out group-hover:translate-y-0.5"
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>
        </svg>
      </a>
    </div>
  );
}

export function HeroSection() {
  const { t, dir } = useI18n();
  const [mounted, setMounted] = useState(false);
  const mouse = useMouseParallax(0.008);
  const scrollRef = useScrollParallax();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section
      ref={scrollRef as React.RefObject<HTMLElement>}
      dir={dir}
      className="hero-parallax-root relative overflow-hidden pt-20 pb-12 md:pt-24 md:pb-16"
    >
      {/* ===== Premium animated background ===== */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Soft base wash */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-primary-glow/[0.05]" />

        {/* Morphing gradient blobs */}
        <div
          className="hero-blob-1 absolute -top-32 -left-24 h-[520px] w-[520px] blur-[110px] opacity-60"
          style={{
            background: "radial-gradient(circle at 30% 30%, rgba(155, 92, 246, 0.55), rgba(190, 94, 237, 0.25) 60%, transparent 80%)",
            transform: `translate(${mouse.x * 1.5}px, ${mouse.y * 1.5}px)`,
          }}
        />
        <div
          className="hero-blob-2 absolute top-10 -right-32 h-[460px] w-[460px] blur-[120px] opacity-55"
          style={{
            background: "radial-gradient(circle at 70% 40%, rgba(124, 58, 237, 0.5), rgba(155, 92, 246, 0.2) 55%, transparent 80%)",
            transform: `translate(${mouse.x * -1.2}px, ${mouse.y * -1.2}px)`,
          }}
        />
        <div
          className="hero-blob-3 absolute bottom-[-120px] left-1/3 h-[420px] w-[420px] blur-[130px] opacity-45"
          style={{
            background: "radial-gradient(circle at 50% 50%, rgba(190, 94, 237, 0.45), transparent 70%)",
            transform: `translate(${mouse.x * 0.9}px, ${mouse.y * -0.9}px)`,
          }}
        />

        {/* Animated dotted grid */}
        <div
          className="hero-grid-pan absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "radial-gradient(circle, oklch(0.53 0.27 290) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Subtle conic shimmer beam */}
        <div className="absolute top-0 left-0 right-0 h-[600px] overflow-hidden">
          <div className="hero-beam-sweep absolute top-0 -left-1/2 h-full w-1/2 bg-gradient-to-r from-transparent via-primary/[0.07] to-transparent" />
        </div>

        {/* SVG decorative shapes */}
        <svg
          className="absolute top-20 right-[10%] h-24 w-24 text-primary/20 hero-drift hidden md:block"
          viewBox="0 0 100 100" fill="none"
          style={{ transform: `translate(${mouse.x * 2}px, ${mouse.y * 2}px)` }}
        >
          <polygon points="50,5 95,80 5,80" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <svg
          className="absolute bottom-32 left-[8%] h-20 w-20 text-primary-glow/25 hero-drift hidden md:block"
          viewBox="0 0 100 100" fill="none"
          style={{ animationDelay: "3s", transform: `translate(${mouse.x * -1.5}px, ${mouse.y * 1.5}px)` }}
        >
          <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 6" />
        </svg>
        <svg
          className="absolute top-1/3 left-[5%] h-14 w-14 text-primary/25 animate-spin-slow hidden lg:block"
          viewBox="0 0 100 100" fill="none"
        >
          <rect x="20" y="20" width="60" height="60" rx="12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Floating particles + twinkling stars */}
      <div className="pointer-events-none absolute inset-0 hero-scroll-fade">
        {[
          { top: "12%", left: "6%",  size: 6,  mx: 2,    my: 1.5 },
          { top: "22%", left: "88%", size: 4,  mx: -1.5, my: 2 },
          { top: "50%", left: "92%", size: 8,  mx: 1,    my: -1 },
          { top: "60%", left: "10%", size: 4,  mx: -2,   my: -1.5 },
          { top: "75%", left: "70%", size: 6,  mx: 1.5,  my: 1 },
          { top: "35%", left: "4%",  size: 4,  mx: -1,   my: 2 },
          { top: "18%", left: "45%", size: 3,  mx: 1,    my: -2 },
          { top: "82%", left: "30%", size: 5,  mx: -1.2, my: 1 },
        ].map((p, i) => (
          <div
            key={i}
            className="hero-star-twinkle absolute rounded-full bg-primary"
            style={{
              top: p.top, left: p.left,
              width: p.size, height: p.size,
              animationDelay: `${i * 0.4}s`,
              transform: `translate(${mouse.x * p.mx}px, ${mouse.y * p.my}px)`,
            }}
          />
        ))}
      </div>

      <div className="relative mx-auto max-w-7xl px-4 text-center">
        {/* Badge */}
        <div
          className={`hero-scroll-lift-sm mb-8 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-5 py-2 text-sm text-primary transition-all duration-700 ${
            mounted ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95"
          }`}
        >
          <span className="font-semibold text-primary">{t.hero.badge}</span>
        </div>

        {/* Title */}
        <h1 className="hero-scroll-lift mx-auto max-w-4xl text-2xl font-extrabold leading-tight tracking-tight text-foreground md:text-4xl lg:text-5xl">
          <span className={`inline-block transition-all duration-700 delay-100 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            {t.hero.title1}
          </span>
          <br />
          <span className={`inline-block gradient-text-animated transition-all duration-700 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            {t.hero.title2}
          </span>
          <br />
          <span className={`inline-block transition-all duration-700 delay-300 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            {t.hero.title3}
          </span>
        </h1>

        <p className={`hero-scroll-lift-sm mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg transition-all duration-700 delay-400 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          {t.hero.desc}
        </p>

        {/* CTAs */}
        <CtaButtons mounted={mounted} t={t} />

        {/* Stats */}
        <div
          className={`hero-scroll-lift-card mx-auto mt-16 max-w-3xl rounded-2xl glass-card p-1 shadow-lg shadow-black/5 transition-all duration-1000 delay-600 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
        >
          <div className="rounded-xl bg-gradient-to-br from-primary/3 via-transparent to-primary-glow/3 p-8 md:p-12">
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

        {/* Chat mockup — mouse tilt + scroll via CSS */}
        <div
          className={`hero-scroll-lift-mockup mx-auto mt-12 max-w-2xl transition-all duration-1000 delay-700 ${
            mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
          style={{
            transform: mounted
              ? `perspective(800px) rotateX(${mouse.y * -0.015}deg) rotateY(${mouse.x * 0.015}deg)`
              : undefined,
          }}
        >
          <div className="relative">
            {/* Floating badges — scroll bob via CSS var */}
            <div
              className="hero-scroll-bob absolute -top-4 -right-2 md:-right-8 z-10 rounded-xl glass-card px-4 py-2.5 shadow-md"
              style={{ transform: `translateX(${mouse.x * 0.4}px)` }}
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-400" />
                <span className="text-xs font-medium text-foreground">{dir === "rtl" ? "مباشر" : "Live"}</span>
                <span className="text-xs text-muted-foreground">• 234 {dir === "rtl" ? "متصل" : "online"}</span>
              </div>
            </div>
            <div
              className="hero-scroll-bob-reverse absolute -bottom-3 -left-2 md:-left-8 z-10 rounded-xl glass-card px-4 py-2.5 shadow-md"
              style={{ transform: `translateX(${mouse.x * -0.4}px)` }}
            >
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
                <span className="text-xs font-medium text-foreground">1,247 {dir === "rtl" ? "رسالة اليوم" : "sent today"}</span>
              </div>
            </div>

            {/* Main mockup — premium chat UI */}
            <div className="rounded-2xl glass-card overflow-hidden shadow-xl shadow-primary/10 border border-border/60">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2.5 bg-accent/30">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-300" />
                  <div className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
                  <div className="h-2.5 w-2.5 rounded-full bg-green-300" />
                </div>
                <div className="mx-auto flex items-center gap-1.5 rounded-md bg-background/60 px-3 py-0.5 text-[11px] text-muted-foreground font-medium">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  flowtixtools.com
                </div>
              </div>

              {/* Conversation header */}
              <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3 bg-background/40">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                      {dir === "rtl" ? "ف" : "F"}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card" />
                  </div>
                  <div className="text-start">
                    <div className="text-xs font-semibold text-foreground">{dir === "rtl" ? "Flowtix AI" : "Flowtix AI"}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <span className="h-1 w-1 rounded-full bg-green-500" />
                      {dir === "rtl" ? "متصل الآن • يرد فوراً" : "Online • replies instantly"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <button className="h-7 w-7 rounded-full hover:bg-accent flex items-center justify-center" aria-label="call">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>
                  </button>
                  <button className="h-7 w-7 rounded-full hover:bg-accent flex items-center justify-center" aria-label="more">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="p-4 md:p-5 space-y-3 bg-gradient-to-b from-transparent to-accent/10">
                {/* Customer */}
                <div className="flex gap-2.5 items-end">
                  <div className="h-7 w-7 shrink-0 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-foreground/70">
                    {dir === "rtl" ? "أ" : "A"}
                  </div>
                  <div className="flex flex-col gap-0.5 max-w-[75%] items-start">
                    <div className="rounded-2xl rounded-bl-sm bg-card border border-border/60 px-3.5 py-2 shadow-sm">
                      <p className="text-sm text-foreground leading-relaxed">{dir === "rtl" ? "مرحباً، عايز أعرف سعر المنتج ده 👀" : "Hi, I want to know the price of this product 👀"}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground px-1">10:24</span>
                  </div>
                </div>

                {/* AI reply */}
                <div className="flex gap-2.5 items-end justify-end">
                  <div className="flex flex-col gap-0.5 max-w-[78%] items-end">
                    <div className="rounded-2xl rounded-br-sm px-3.5 py-2 shadow-md text-white" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                      <div className="flex items-center gap-1.5 mb-1 opacity-90">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>
                        <span className="text-[10px] font-semibold tracking-wide">{dir === "rtl" ? "Flowtix AI" : "Flowtix AI"}</span>
                      </div>
                      <p className="text-sm leading-relaxed">{dir === "rtl" ? "أهلاً بك! 🎉 عندنا 3 باقات تناسب احتياجك تماماً، تحب أعرض عليك التفاصيل؟" : "Hello! 🎉 We have 3 plans tailored for you. Want me to show the details?"}</p>
                    </div>
                    <div className="flex items-center gap-1 px-1">
                      <span className="text-[10px] text-muted-foreground">10:24</span>
                      <svg className="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/><polyline points="22 10 14 18"/></svg>
                    </div>
                  </div>
                  <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center shadow-sm" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/></svg>
                  </div>
                </div>

                {/* Typing */}
                <div className="flex gap-2.5 items-end justify-end">
                  <div className="rounded-2xl rounded-br-sm bg-accent/60 px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce-subtle" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce-subtle delay-100" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce-subtle delay-200" />
                    </div>
                  </div>
                  <div className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center shadow-sm" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                    <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 8V4H8"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M12 16v4h4"/></svg>
                  </div>
                </div>
              </div>

              {/* Composer */}
              <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2.5 bg-background/40">
                <button className="h-8 w-8 rounded-full hover:bg-accent flex items-center justify-center text-muted-foreground" aria-label="attach">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                </button>
                <div className="flex-1 rounded-full bg-accent/40 px-4 py-1.5 text-xs text-muted-foreground/70">
                  {dir === "rtl" ? "اكتب رسالتك..." : "Type a message..."}
                </div>
                <button className="h-8 w-8 rounded-full flex items-center justify-center text-white shadow-sm" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }} aria-label="send">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator — fades via CSS var */}
        <div className={`hero-scroll-indicator mt-12 transition-all duration-1000 delay-800 ${mounted ? "" : "opacity-0"}`}>
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

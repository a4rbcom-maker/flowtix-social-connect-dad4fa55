import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";
import { useEffect, useRef, useState } from "react";

// ============================================================
// Stats Strip — bold, numeric proof bar
// ============================================================

function CountUp({ end, suffix = "", duration = 1800 }: { end: number; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(Math.floor(eased * end));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.unobserve(el);
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [end, duration]);
  return <span ref={ref} className="tabular-nums">{val.toLocaleString()}{suffix}</span>;
}

export function StatsStrip() {
  const { dir, lang } = useI18n();
  const isAr = lang === "ar";
  const { ref, isInView } = useInView();

  const stats = [
    { value: 2400, suffix: "+", label: isAr ? "عميل نشط" : "Active customers" },
    { value: 1200000, suffix: "+", label: isAr ? "رسالة مرسلة" : "Messages sent" },
    { value: 99, suffix: "%", label: isAr ? "نسبة وصول" : "Delivery rate" },
    { value: 24, suffix: "/7", label: isAr ? "دعم فني" : "Live support" },
  ];

  return (
    <section dir={dir} className="relative overflow-hidden py-12 md:py-16">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary-glow/5 to-primary/5" />
      <div ref={ref} className="relative mx-auto max-w-7xl px-4">
        <div className="grid grid-cols-2 gap-y-10 gap-x-6 md:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={i}
              className={`relative text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="bg-primary bg-clip-text text-4xl font-extrabold text-transparent md:text-5xl">
                <CountUp end={s.value} suffix={s.suffix} />
              </div>
              <div className="mt-2 text-sm font-medium text-muted-foreground md:text-base">{s.label}</div>
              {i < stats.length - 1 && (
                <div className="absolute top-1/2 -right-3 hidden h-12 w-px -translate-y-1/2 bg-border md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Testimonials — premium social proof with avatars
// ============================================================

export function TestimonialsSection() {
  const { dir, lang } = useI18n();
  const isAr = lang === "ar";
  const { ref, isInView } = useInView();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const items = isAr
    ? [
        { name: "أحمد المصري", role: "صاحب متجر إلكتروني", company: "متجر أناقة", body: "وفّرت عليّ ساعات يومياً. الإرسال للجروبات بقى أسرع 10 مرات والرد التلقائي على واتساب رهيب. خلال شهر واحد، تضاعفت مبيعاتنا.", rating: 5, metric: "+120% مبيعات" },
        { name: "سارة عبد الله", role: "مدير تسويق", company: "شركة نون", body: "أفضل أداة جربتها للتجارة الاجتماعية. الواجهة بسيطة والنتائج مذهلة — مبيعاتنا زادت 40% في أول شهر استخدام.", rating: 5, metric: "+40% تحويلات" },
        { name: "محمود حسن", role: "مؤسس وكالة تسويق", company: "Reach Agency", body: "بنستخدمها لأكثر من 30 عميل. الاستقرار ممتاز والدعم الفني سريع جداً. توصية بقوة لأي وكالة تسويق.", rating: 5, metric: "30+ عميل" },
        { name: "فاطمة الزهراء", role: "صاحبة براند ملابس", company: "Zahra Fashion", body: "البوت بيرد على عملائي 24/7 بطريقة طبيعية جداً، حسّيت كأن في موظف خدمة عملاء حقيقي. تجربة لا تُنسى.", rating: 5, metric: "24/7 رد فوري" },
        { name: "خالد العتيبي", role: "Dropshipper", company: "Khalid Store", body: "كل أدوات إدارة فيسبوك وواتساب في مكان واحد. وفّرت عليّ اشتراكات بـ 200$ شهرياً. شيء مذهل فعلاً.", rating: 5, metric: "200$ توفير شهري" },
      ]
    : [
        { name: "Ahmed Elmasry", role: "E-commerce owner", company: "Anaqa Store", body: "Saved me hours every day. Group posting is 10x faster and the WhatsApp auto-reply is incredible. Sales doubled within a month.", rating: 5, metric: "+120% sales" },
        { name: "Sarah Abdullah", role: "Marketing manager", company: "Noon Co.", body: "The best social commerce tool I've tried. Simple UI, amazing results — sales grew 40% in our first month.", rating: 5, metric: "+40% conversions" },
        { name: "Mahmoud Hassan", role: "Agency founder", company: "Reach Agency", body: "We use it for 30+ clients. Rock-solid stability and lightning-fast support. Highly recommend for any marketing agency.", rating: 5, metric: "30+ clients" },
        { name: "Fatima Alzahra", role: "Fashion brand owner", company: "Zahra Fashion", body: "The bot replies to my customers 24/7 so naturally I felt there's a real agent behind it. Unforgettable experience.", rating: 5, metric: "24/7 instant reply" },
        { name: "Khaled Alotaibi", role: "Dropshipper", company: "Khalid Store", body: "All Facebook & WhatsApp management tools in one place. Saved me $200/month in subscriptions. Simply amazing.", rating: 5, metric: "$200 saved/month" },
      ];

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((a) => (a + 1) % items.length), 5500);
    return () => clearInterval(id);
  }, [paused, items.length]);

  return (
    <section dir={dir} className="relative overflow-hidden py-12 md:py-16">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 h-72 w-72 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-72 w-72 rounded-full bg-primary-glow/5 blur-[120px]" />
      </div>

      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-12 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
            {isAr ? "آراء العملاء" : "Testimonials"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">
            {isAr ? "أحبّها آلاف العملاء" : "Loved by thousands"}
          </h2>
          <p className="mt-4 text-base text-muted-foreground md:text-lg">
            {isAr ? "تقييمات حقيقية من أصحاب أعمال يستخدمون فلوتكس يومياً" : "Real reviews from business owners using Flowtix daily"}
          </p>

          <div className="mt-6 inline-flex items-center gap-3 rounded-full border border-border/60 bg-card/60 px-4 py-2 backdrop-blur-sm">
            <div className="flex gap-0.5 text-amber-400">
              {Array.from({ length: 5 }).map((_, s) => (
                <svg key={s} className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              ))}
            </div>
            <span className="text-sm font-semibold text-foreground">4.9/5</span>
            <span className="h-3 w-px bg-border" />
            <span className="text-xs text-muted-foreground">{isAr ? "من +2,400 تقييم" : "from 2,400+ reviews"}</span>
          </div>
        </div>

        <div
          className={`relative mx-auto max-w-4xl transition-all duration-700 delay-150 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/80 p-8 shadow-xl shadow-primary/5 backdrop-blur-sm md:p-12">
            <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }} />

            <svg className="mb-4 h-10 w-10" viewBox="0 0 24 24" fill="none">
              <path d="M9.983 3v7.391c0 5.704-3.731 9.57-8.983 10.609l-.995-2.151c2.432-.917 3.995-3.638 3.995-5.849h-4v-10h9.983zm14.017 0v7.391c0 5.704-3.748 9.571-9 10.609l-.996-2.151c2.433-.917 3.996-3.638 3.996-5.849h-3.983v-10h9.983z" fill="url(#quoteGrad)"/>
              <defs>
                <linearGradient id="quoteGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                  <stop stopColor="rgb(138,61,245)"/>
                  <stop offset="1" stopColor="rgb(190,94,237)"/>
                </linearGradient>
              </defs>
            </svg>

            <div className="relative min-h-[220px]">
              {items.map((t, i) => (
                <div
                  key={i}
                  className={`transition-all duration-500 ${i === active ? "opacity-100 relative translate-x-0" : "opacity-0 absolute inset-0 pointer-events-none translate-x-4"}`}
                >
                  <div className="mb-4 flex gap-1 text-amber-400">
                    {Array.from({ length: t.rating }).map((_, s) => (
                      <svg key={s} className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    ))}
                  </div>
                  <p className="mb-8 text-lg leading-relaxed text-foreground md:text-xl">"{t.body}"</p>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white shadow-lg" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                        {t.name.charAt(0)}
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-green-500">
                          <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12"/></svg>
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.role} · {t.company}</div>
                      </div>
                    </div>
                    <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      {t.metric}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-border/40 pt-6">
              <div className="flex gap-1.5">
                {items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActive(i)}
                    aria-label={`Slide ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === active ? "w-8 bg-primary" : "w-1.5 bg-border hover:bg-primary/40"}`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setActive((a) => (a - 1 + items.length) % items.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  aria-label="Previous"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {dir === "rtl" ? <polyline points="9 18 15 12 9 6"/> : <polyline points="15 18 9 12 15 6"/>}
                  </svg>
                </button>
                <button
                  onClick={() => setActive((a) => (a + 1) % items.length)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                  aria-label="Next"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {dir === "rtl" ? <polyline points="15 18 9 12 15 6"/> : <polyline points="9 18 15 12 9 6"/>}
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3 md:grid-cols-5">
          {items.map((t, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`group relative overflow-hidden rounded-xl border p-3 text-start transition-all duration-300 hover:-translate-y-0.5 ${
                i === active
                  ? "border-primary/40 bg-primary/5 shadow-md shadow-primary/10"
                  : "border-border/60 bg-card/60 hover:border-primary/30 hover:bg-card"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, rgb(138,61,245), rgb(190,94,237))" }}>
                  {t.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-foreground">{t.name}</div>
                  <div className="flex gap-0.5 text-amber-400">
                    {Array.from({ length: t.rating }).map((_, s) => (
                      <svg key={s} className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}


// ============================================================
// Why Choose Us — Before vs After comparison
// ============================================================

export function ComparisonSection() {
  const { dir, lang } = useI18n();
  const isAr = lang === "ar";
  const { ref, isInView } = useInView();

  const without = isAr
    ? ["إرسال يدوي ساعات لكل جروب", "بدون رد آلي على العملاء", "صعوبة في تتبع الرسائل", "فقدان عملاء بسبب التأخر", "أدوات متفرقة ومكلفة"]
    : ["Hours manually posting per group", "No automated replies", "Hard to track messages", "Lost customers from delays", "Scattered, expensive tools"];

  const withUs = isAr
    ? ["إرسال جماعي بضغطة واحدة", "بوت AI يرد فوراً 24/7", "لوحة تحكم بكل الإحصائيات", "رد فوري يحوّل الزوار لعملاء", "كل شيء في منصة واحدة"]
    : ["One-click bulk posting", "AI bot replies 24/7 instantly", "Dashboard with full analytics", "Instant replies convert visitors", "Everything in one platform"];

  return (
    <section dir={dir} className="relative py-12 md:py-16 bg-accent/20">
      <div ref={ref} className="mx-auto max-w-6xl px-4">
        <div className={`mb-14 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            {isAr ? "⚡ الفرق واضح" : "⚡ See the difference"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">
            {isAr ? "قبل وبعد فلوتكس" : "Before vs With Flowtix"}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            {isAr ? "اكتشف لماذا يختار آلاف الأعمال منصتنا" : "See why thousands of businesses choose us"}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Without */}
          <div className={`rounded-2xl border border-destructive/15 bg-destructive/5 p-7 transition-all duration-700 ${isInView ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"}`}>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </div>
              <h3 className="text-xl font-bold text-foreground">{isAr ? "بدون فلوتكس" : "Without Flowtix"}</h3>
            </div>
            <ul className="space-y-3">
              {without.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </span>
                  <span className="line-through opacity-70">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* With us */}
          <div className={`relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-primary-glow/8 p-7 shadow-xl shadow-primary/10 transition-all duration-700 delay-150 ${isInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}`}>
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />
            <div className="relative">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h3 className="text-xl font-bold text-foreground">{isAr ? "مع فلوتكس" : "With Flowtix"}</h3>
                <span className="ml-auto rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  {isAr ? "موصى به" : "Recommended"}
                </span>
              </div>
              <ul className="space-y-3">
                {withUs.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm font-medium text-foreground">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

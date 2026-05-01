import { useI18n } from "@/lib/i18n";

export function HeroSection() {
  const { t, dir } = useI18n();

  return (
    <section dir={dir} className="relative overflow-hidden pt-24 pb-20 md:pt-32 md:pb-28">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-blue-500/15 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary">
          {t.hero.badge}
        </div>

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-tight tracking-tight text-foreground md:text-6xl lg:text-7xl">
          {t.hero.title1}
          <br />
          <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
            {t.hero.title2}
          </span>
          <br />
          {t.hero.title3}
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          {t.hero.desc}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <button className="rounded-xl bg-gradient-to-r from-primary to-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30">
            {t.hero.cta}
          </button>
          <a
            href="#features"
            className="rounded-xl border border-border px-8 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-accent"
          >
            {t.hero.ctaSecondary}
          </a>
        </div>

        <div className="mx-auto mt-16 max-w-3xl rounded-2xl border border-border/50 bg-card/50 p-1 shadow-2xl shadow-primary/5 backdrop-blur-sm">
          <div className="rounded-xl bg-gradient-to-br from-primary/5 to-blue-500/5 p-8 md:p-12">
            <div className="grid grid-cols-3 gap-8 text-center">
              <div>
                <div className="text-3xl font-bold text-primary md:text-4xl">+2K</div>
                <div className="mt-1 text-xs text-muted-foreground md:text-sm">
                  {dir === "rtl" ? "مستخدم نشط" : "Active Users"}
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary md:text-4xl">+50K</div>
                <div className="mt-1 text-xs text-muted-foreground md:text-sm">
                  {dir === "rtl" ? "رسالة يومياً" : "Messages/Day"}
                </div>
              </div>
              <div>
                <div className="text-3xl font-bold text-primary md:text-4xl">99%</div>
                <div className="mt-1 text-xs text-muted-foreground md:text-sm">
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

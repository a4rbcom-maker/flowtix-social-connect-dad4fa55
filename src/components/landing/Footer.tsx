import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";
import { useState, useEffect } from "react";
import flowtixLogo from "@/assets/flowtix-logo.png";

function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-lg shadow-primary/30 transition-all duration-300 hover:scale-110 hover:shadow-xl hover:shadow-primary/40 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      }`}
      aria-label="Scroll to top"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m18 15-6-6-6 6"/>
      </svg>
    </button>
  );
}

const SocialIcon = ({ children, label, href }: { children: React.ReactNode; label: string; href: string }) => (
  <a
    href={href}
    aria-label={label}
    target="_blank"
    rel="noopener noreferrer"
    className="group relative flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-muted-foreground backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:text-primary hover:shadow-lg hover:shadow-primary/10"
  >
    {children}
  </a>
);

export function Footer() {
  const { t, dir, lang } = useI18n();
  const { ref, isInView } = useInView();
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubscribed(true);
    setEmail("");
    setTimeout(() => setSubscribed(false), 3000);
  };

  const isAr = lang === "ar";

  return (
    <>
      <footer dir={dir} className="relative overflow-hidden border-t border-border/50 bg-gradient-to-b from-background via-card/40 to-card/60">
        {/* Decorative blurred orbs */}
        <div className="pointer-events-none absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-primary-glow/15 blur-3xl" aria-hidden="true" />

        {/* Animated gradient top border */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div ref={ref} className="relative mx-auto max-w-7xl px-4 pt-20 pb-8">
          {/* Newsletter CTA card */}
          <div className={`mb-16 overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/8 via-card to-primary-glow/8 p-8 shadow-xl shadow-primary/5 backdrop-blur-sm md:p-12 transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  {isAr ? "ابق على اطلاع" : "Stay in the loop"}
                </div>
                <h3 className="text-2xl font-bold text-foreground md:text-3xl">
                  {isAr ? "اشترك في النشرة البريدية" : "Subscribe to our newsletter"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground md:text-base">
                  {isAr ? "أحدث التحديثات، النصائح، والعروض الحصرية مباشرة إلى بريدك" : "Latest updates, tips, and exclusive offers straight to your inbox"}
                </p>
              </div>

              <form onSubmit={handleSubscribe} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isAr ? "بريدك الإلكتروني" : "your@email.com"}
                  className="flex-1 rounded-xl border border-border bg-background/80 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 backdrop-blur transition-all focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="submit"
                  className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-primary to-primary-glow px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-300 hover:shadow-xl hover:shadow-primary/40 active:scale-95"
                >
                  <span className="relative z-10">
                    {subscribed ? (isAr ? "✓ تم الاشتراك" : "✓ Subscribed") : (isAr ? "اشترك" : "Subscribe")}
                  </span>
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                </button>
              </form>
            </div>
          </div>

          {/* Main grid */}
          <div className={`grid gap-10 md:grid-cols-2 lg:grid-cols-12 transition-all duration-700 delay-100 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            {/* Brand column */}
            <div className="lg:col-span-5">
              <div className="mb-5 flex items-center gap-3 group">
                <div className="relative">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary to-primary-glow opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-60" />
                  <img src={flowtixLogo} alt="Flowtix Tools" width={40} height={40} className="relative h-10 w-10 transition-transform duration-300 group-hover:rotate-6" loading="lazy" />
                </div>
                <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-xl font-bold text-transparent">
                  Flowtix Tools
                </span>
              </div>
              <p className="mb-6 max-w-md text-sm leading-relaxed text-muted-foreground">{t.footer.desc}</p>

              {/* Social icons */}
              <div className="flex flex-wrap items-center gap-2">
                <SocialIcon label="Facebook" href="https://facebook.com">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg>
                </SocialIcon>
                <SocialIcon label="Twitter" href="https://twitter.com">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </SocialIcon>
                <SocialIcon label="Instagram" href="https://instagram.com">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>
                </SocialIcon>
                <SocialIcon label="LinkedIn" href="https://linkedin.com">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5C4.98 4.881 3.87 6 2.5 6S.02 4.881.02 3.5C.02 2.12 1.13 1 2.5 1s2.48 1.12 2.48 2.5zM5 8H0v16h5V8zm7.982 0H8.014v16h4.969v-8.399c0-4.67 6.029-5.052 6.029 0V24H24V13.869c0-7.88-8.922-7.593-11.018-3.714V8z"/></svg>
                </SocialIcon>
                <SocialIcon label="YouTube" href="https://youtube.com">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </SocialIcon>
              </div>
            </div>

            {/* Links columns */}
            <div className="lg:col-span-3">
              <h4 className="mb-5 text-sm font-bold uppercase tracking-wider text-foreground">{t.footer.links}</h4>
              <div className="flex flex-col gap-3">
                {[
                  { href: "#features", label: t.nav.features },
                  { href: "#how-it-works", label: t.nav.howItWorks },
                  { href: "#pricing", label: t.nav.pricing },
                  { href: "#faq", label: t.nav.faq },
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="group inline-flex items-center gap-2 text-sm text-muted-foreground transition-all duration-200 hover:text-primary"
                  >
                    <span className="h-px w-3 bg-muted-foreground/40 transition-all duration-300 group-hover:w-6 group-hover:bg-primary" />
                    {link.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4">
              <h4 className="mb-5 text-sm font-bold uppercase tracking-wider text-foreground">{t.footer.contact}</h4>
              <div className="flex flex-col gap-3 text-sm">
                <a href="mailto:support@flowtixtools.com" className="group flex items-center gap-3 text-muted-foreground transition-colors duration-200 hover:text-primary">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-primary transition-all group-hover:border-primary/40 group-hover:bg-primary/5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
                  </span>
                  support@flowtixtools.com
                </a>
                <a href="https://flowtixtools.com" className="group flex items-center gap-3 text-muted-foreground transition-colors duration-200 hover:text-primary">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-primary transition-all group-hover:border-primary/40 group-hover:bg-primary/5">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  </span>
                  flowtixtools.com
                </a>
                <div className="group flex items-center gap-3 text-muted-foreground">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-primary">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  </span>
                  {isAr ? "القاهرة، مصر" : "Cairo, Egypt"}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className={`mt-16 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-8 text-sm text-muted-foreground md:flex-row transition-all duration-700 delay-200 ${isInView ? "opacity-100" : "opacity-0"}`}>
            <div className="flex items-center gap-2">
              <span>© {new Date().getFullYear()} Flowtix Tools.</span>
              <span>{t.footer.rights}.</span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#" className="transition-colors hover:text-primary">{isAr ? "الخصوصية" : "Privacy"}</a>
              <span className="h-1 w-1 rounded-full bg-border" />
              <a href="#" className="transition-colors hover:text-primary">{isAr ? "الشروط" : "Terms"}</a>
              <span className="h-1 w-1 rounded-full bg-border" />
              <a href="#" className="transition-colors hover:text-primary">{isAr ? "الكوكيز" : "Cookies"}</a>
            </div>
          </div>
        </div>
      </footer>
      <ScrollToTop />
    </>
  );
}

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
      className={`fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/25 transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:shadow-primary/40 ${
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

export function Footer() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <>
      <footer dir={dir} className="relative border-t border-border/50 bg-card/30 py-16">
        {/* Animated gradient top border */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-shimmer" style={{ backgroundSize: "200% 100%" }} />

        <div ref={ref} className="mx-auto max-w-7xl px-4">
          <div className={`grid gap-8 md:grid-cols-3 transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
            <div>
              <div className="mb-4 flex items-center gap-2 group">
                <img src={flowtixLogo} alt="Flowtix Tools" width={32} height={32} className="h-8 w-8 transition-transform duration-300 group-hover:rotate-12" loading="lazy" />
                <span className="gradient-text-animated text-lg font-bold">
                  Flowtix Tools
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.footer.desc}</p>
            </div>

            <div>
              <h4 className="mb-4 font-semibold text-foreground">{t.footer.links}</h4>
              <div className="flex flex-col gap-2">
                {[
                  { href: "#features", label: t.nav.features },
                  { href: "#how-it-works", label: t.nav.howItWorks },
                  { href: "#pricing", label: t.nav.pricing },
                  { href: "#faq", label: t.nav.faq },
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="group inline-flex items-center gap-1 text-sm text-muted-foreground transition-all duration-200 hover:text-primary hover:translate-x-1"
                  >
                    <svg className="h-3 w-3 opacity-0 -translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                    {link.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-4 font-semibold text-foreground">{t.footer.contact}</h4>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <a href="mailto:support@flowtixtools.com" className="transition-colors duration-200 hover:text-primary">support@flowtixtools.com</a>
                <span className="transition-colors duration-200 hover:text-primary cursor-default">flowtixtools.com</span>
              </div>
            </div>
          </div>

          <div className={`mt-10 border-t border-border/50 pt-6 text-center text-sm text-muted-foreground transition-all duration-700 delay-200 ${isInView ? "opacity-100" : "opacity-0"}`}>
            © {new Date().getFullYear()} Flowtix Tools. {t.footer.rights}.
          </div>
        </div>
      </footer>
      <ScrollToTop />
    </>
  );
}

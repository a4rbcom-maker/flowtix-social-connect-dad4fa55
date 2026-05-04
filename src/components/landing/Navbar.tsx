import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import flowtixLogo from "@/assets/flowtix-logo.png";

export function Navbar() {
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggleTheme, mounted } = useTheme();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      dir={dir}
      className={`fixed top-0 left-0 right-0 z-50 border-b border-border/50 backdrop-blur-xl transition-all duration-300 ${
        scrolled ? "bg-background/95 py-2 shadow-lg shadow-primary/5" : "bg-background/80 py-3"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <img
            src={flowtixLogo}
            alt="Flowtix Tools"
            width={40}
            height={40}
            className={`transition-all duration-300 ${scrolled ? "h-8 w-8" : "h-10 w-10"}`}
          />
          <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-xl font-bold text-transparent">
            Flowtix Tools
          </span>
        </div>

        <div className="hidden items-center gap-6 md:flex">
          <Link to="/" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">{t.nav.home}</Link>
          <a href="#features" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">{t.nav.features}</a>
          <a href="#how-it-works" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">{t.nav.howItWorks}</a>
          <a href="#pricing" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">{t.nav.pricing}</a>
          <a href="#faq" className="nav-link text-sm text-muted-foreground transition-colors hover:text-foreground">{t.nav.faq}</a>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="btn-luxury-base btn-luxury-icon !px-3 !py-1.5 text-xs"
          >
            {lang === "ar" ? "EN" : "عربي"}
          </button>
          <button
            onClick={toggleTheme}
            className="btn-luxury-base btn-luxury-icon"
            aria-label="Toggle theme"
          >
            {mounted ? (
              theme === "dark" ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
          <Link to="/login" className="btn-luxury-base btn-luxury hidden !px-4 !py-2 text-sm md:inline-flex">
            {t.nav.startFree}
          </Link>
          <button onClick={() => setOpen(!open)} className="p-2 text-foreground md:hidden" aria-label="Menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-slide-up border-t border-border bg-background px-4 py-4 md:hidden" dir={dir}>
          <div className="flex flex-col gap-3">
            <Link to="/" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">{t.nav.home}</Link>
            <a href="#features" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">{t.nav.features}</a>
            <a href="#how-it-works" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">{t.nav.howItWorks}</a>
            <a href="#pricing" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">{t.nav.pricing}</a>
            <a href="#faq" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">{t.nav.faq}</a>
            <button
              onClick={() => { setLang(lang === "ar" ? "en" : "ar"); setOpen(false); }}
              className="btn-luxury-base btn-luxury-outline !px-4 !py-2 text-sm"
            >
              {lang === "ar" ? "English" : "العربية"}
            </button>
            <Link to="/login" onClick={() => setOpen(false)} className="btn-luxury-base btn-luxury !px-4 !py-2 text-sm">{t.nav.startFree}</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

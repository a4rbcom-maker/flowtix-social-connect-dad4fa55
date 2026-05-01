import { useI18n } from "@/lib/i18n";
import flowtixLogo from "@/assets/flowtix-logo.png";

export function Footer() {
  const { t, dir } = useI18n();

  return (
    <footer dir={dir} className="border-t border-border/50 bg-card/30 py-12">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <img src={flowtixLogo} alt="Flowtix Tools" width={32} height={32} className="h-8 w-8" loading="lazy" />
              <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-lg font-bold text-transparent">
                Flowtix Tools
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.footer.desc}</p>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-foreground">{t.footer.links}</h4>
            <div className="flex flex-col gap-2">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground">{t.nav.features}</a>
              <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground">{t.nav.howItWorks}</a>
              <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">{t.nav.pricing}</a>
              <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground">{t.nav.faq}</a>
            </div>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-foreground">{t.footer.contact}</h4>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <span>support@flowtixtools.com</span>
              <span>flowtixtools.com</span>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border/50 pt-6 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Flowtix Tools. {t.footer.rights}.
        </div>
      </div>
    </footer>
  );
}

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Twitter, Github, Linkedin } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { ScrollToTop } from "@/components/shared/ScrollToTop";
import { siteConfig } from "@/config/site";

export function Footer() {
  const { t } = useTranslation();

  const columns = [
    {
      title: t("footer.product"),
      links: [
        { label: t("footer.links.features"), href: "#features" },
        { label: t("footer.links.pricing"), href: "#pricing" },
        { label: t("footer.links.automation"), href: "#automation" },
      ],
    },
    {
      title: t("footer.company"),
      links: [
        { label: t("footer.links.about"), href: "#" },
        { label: t("footer.links.careers"), href: "#" },
        { label: t("footer.links.contact"), href: "#" },
      ],
    },
    {
      title: t("footer.resources"),
      links: [
        { label: t("footer.links.docs"), href: "#" },
        { label: t("footer.links.api"), href: "#" },
        { label: t("footer.links.status"), href: "#" },
      ],
    },
    {
      title: t("footer.legal"),
      links: [
        { label: t("footer.links.privacy"), href: "#" },
        { label: t("footer.links.terms"), href: "#" },
        { label: t("footer.links.cookies"), href: "#" },
      ],
    },
  ];

  const socials = [
    { icon: Twitter, href: siteConfig.social.twitter, label: "Twitter" },
    { icon: Github, href: siteConfig.social.github, label: "GitHub" },
    { icon: Linkedin, href: siteConfig.social.linkedin, label: "LinkedIn" },
  ];

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="container-page py-10 sm:py-16">
        <div className="grid gap-8 sm:gap-10 lg:grid-cols-[1.5fr_3fr]">
          <div className="space-y-3 sm:space-y-4">
            <Logo />
            <p className="max-w-xs text-xs leading-relaxed text-[var(--color-fg-muted)] sm:text-sm">
              {t("footer.tagline")}
            </p>
            <div className="flex items-center gap-2">
              {socials.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex size-9 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary-soft)]"
                >
                  <Icon className="size-4" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 sm:gap-8 sm:grid-cols-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-[var(--color-fg)]">{col.title}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-border)] pt-8 sm:flex-row">
          <p className="text-sm text-[var(--color-fg-subtle)]">
            © {new Date().getFullYear()} {t("brand.name")}. {t("footer.rights")}
          </p>
          <Link to="/" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            {t("footer.links.status")}: <span className="text-[var(--color-success)]">●</span> Operational
          </Link>
        </div>
      </div>
      <ScrollToTop />
    </footer>
  );
}

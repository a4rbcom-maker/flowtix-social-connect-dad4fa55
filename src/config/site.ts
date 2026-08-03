export const siteConfig = {
  name: "FlowTix Tools",
  shortName: "FlowTix",
  description:
    "AI-powered SaaS platform for Facebook data extraction, automation and analytics.",
  url: "https://flowtix.tools",
  locale: { default: "ar", fallback: "en" },
  social: {
    twitter: "https://twitter.com/flowtix",
    github: "https://github.com/flowtix",
    linkedin: "https://linkedin.com/company/flowtix",
  },
} as const;

export type SiteConfig = typeof siteConfig;

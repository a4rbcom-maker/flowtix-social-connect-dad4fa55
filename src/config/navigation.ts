import {
  LayoutDashboard,
  Facebook,
  ListChecks,
  UserCircle,
  Settings,
  Users,
  Group,
  CreditCard,
  Globe,
  Palette,
  Bell,
  MessagesSquare,
  MessageCircle,
  Megaphone,
  Bot,
  Sparkles,
  FileText,
  BarChart3,
  Receipt,
  Shield,
  Plug,
  Camera,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  to: string;
  badge?: string;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  to?: string;
  items?: NavItem[];
}

export interface NavSection {
  key: string;
  titleKey?: string;
  groups: NavGroup[];
}

export const dashboardNav: NavSection[] = [
  {
    key: "main",
    groups: [
      {
        key: "home",
        labelKey: "nav.home",
        icon: LayoutDashboard,
        to: "/dashboard",
      },
      {
        key: "facebook",
        labelKey: "nav.facebook",
        icon: Facebook,
        items: [
          { key: "fb-sessions", labelKey: "nav.fbSessions", icon: Plug, to: "/dashboard/facebook/sessions" },
          { key: "fb-extract-members", labelKey: "nav.fbExtractMembers", icon: Users, to: "/dashboard/facebook/extract-members" },
          { key: "fb-messenger-contacts", labelKey: "nav.fbMessengerContacts", icon: MessagesSquare, to: "/dashboard/facebook/messenger-contacts" },
          { key: "fb-groups", labelKey: "nav.fbGroups", icon: Group, to: "/dashboard/facebook/groups" },
        ],
      },
      {
        key: "instagram",
        labelKey: "nav.instagram",
        icon: Camera,
        items: [
          { key: "ig-sessions", labelKey: "nav.igSessions", icon: Plug, to: "/dashboard/instagram/sessions" },
          { key: "ig-extract", labelKey: "nav.igExtract", icon: Users, to: "/dashboard/instagram/extract" },
        ],
      },
      {
        key: "whatsapp",
        labelKey: "nav.whatsapp",
        icon: MessageCircle,
        items: [
          { key: "wa-dashboard",  labelKey: "nav.waDashboard",  icon: LayoutDashboard, to: "/dashboard/whatsapp" },
          { key: "wa-inbox",      labelKey: "nav.waInbox",      icon: MessagesSquare,  to: "/dashboard/whatsapp/inbox" },
          { key: "wa-contacts",   labelKey: "nav.waContacts",   icon: Users,           to: "/dashboard/whatsapp/contacts" },
          { key: "wa-campaigns",  labelKey: "nav.waCampaigns",  icon: Megaphone,       to: "/dashboard/whatsapp/campaigns" },
          { key: "wa-automation", labelKey: "nav.waAutomation", icon: Bot,             to: "/dashboard/whatsapp/automation" },
          { key: "wa-ai-agent",   labelKey: "nav.waAIAgent",    icon: Sparkles,        to: "/dashboard/whatsapp/ai-agent" },
          { key: "wa-templates",  labelKey: "nav.waTemplates",  icon: FileText,        to: "/dashboard/whatsapp/templates" },
          { key: "wa-analytics",  labelKey: "nav.waAnalytics",  icon: BarChart3,       to: "/dashboard/whatsapp/analytics" },
          { key: "wa-settings",   labelKey: "nav.waSettings",   icon: Settings,        to: "/dashboard/whatsapp/settings" },
        ],
      },
    ],
  },
  {
    key: "workflow",
    titleKey: "nav.workflow",
    groups: [
      {
        key: "tasks",
        labelKey: "nav.tasks",
        icon: ListChecks,
        to: "/dashboard/tasks",
      },
    ],
  },
  {
    key: "account",
    titleKey: "nav.accountSection",
    groups: [
      {
        key: "my-account",
        labelKey: "nav.account",
        icon: UserCircle,
        to: "/dashboard/profile",
      },
    ],
  },
  {
    key: "settings-support",
    titleKey: "nav.settingsSupport",
    groups: [
      {
        key: "settings",
        labelKey: "nav.settings",
        icon: Settings,
        items: [
          { key: "language", labelKey: "nav.language", icon: Globe, to: "/dashboard/settings/appearance" },
          { key: "appearance", labelKey: "nav.appearance", icon: Palette, to: "/dashboard/settings/appearance" },
          { key: "notifications", labelKey: "nav.notifications", icon: Bell, to: "/dashboard/settings/notifications" },
        ],
      },
    ],
  },
];

export const adminNav: NavSection[] = [
  {
    key: "admin-main",
    groups: [
      {
        key: "admin-overview",
        labelKey: "dashboard.overview",
        icon: LayoutDashboard,
        to: "/admin",
      },
    ],
  },
  {
    key: "admin-platform",
    titleKey: "admin.nav.platform",
    groups: [
      {
        key: "admin-users",
        labelKey: "admin.users.title",
        icon: Users,
        to: "/admin/users",
      },
      {
        key: "admin-plans",
        labelKey: "admin.plans.title",
        icon: CreditCard,
        to: "/admin/plans",
      },
      {
        key: "admin-subscriptions",
        labelKey: "admin.subscriptions.title",
        icon: Receipt,
        to: "/admin/subscriptions",
      },
    ],
  },
  {
    key: "admin-system",
    titleKey: "admin.nav.system",
    groups: [
      {
        key: "admin-settings",
        labelKey: "admin.settings.title",
        icon: Settings,
        to: "/admin/settings",
      },
      {
        key: "admin-audit-logs",
        labelKey: "admin.auditLogs.title",
        icon: FileText,
        to: "/admin/audit-logs",
      },
      {
        key: "admin-ai-providers",
        labelKey: "admin.aiProviders.title",
        icon: Sparkles,
        to: "/admin/ai-providers",
      },
    ],
  },
  {
    key: "admin-security-support",
    titleKey: "admin.nav.securitySupport",
    groups: [
      {
        key: "admin-security",
        labelKey: "admin.security.title",
        icon: Shield,
        to: "/admin/security",
      },
      {
        key: "admin-profile",
        labelKey: "admin.profile.title",
        icon: UserCircle,
        to: "/admin/profile",
      },
      {
        key: "admin-notifications",
        labelKey: "admin.notifications.title",
        icon: Bell,
        to: "/admin/notifications",
      },
    ],
  },
];

export const publicNav = [
  { key: "features", labelKey: "nav.features", href: "#features" },
  { key: "automation", labelKey: "nav.automation", href: "#automation" },
  { key: "pricing", labelKey: "nav.pricing", href: "#pricing" },
  { key: "faq", labelKey: "nav.faq", href: "#faq" },
] as const;

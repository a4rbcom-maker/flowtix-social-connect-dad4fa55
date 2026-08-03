import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { PublicLayout } from "@/components/layouts/PublicLayout";
import { RequireAuth, GuestOnly, RoleGuard } from "@/components/auth/RouteGuards";
import { LoginPage } from "@/components/auth/LoginPage";
import { RegisterPage } from "@/components/auth/RegisterPage";
import { ForgotPasswordPage } from "@/components/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/components/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/components/auth/VerifyEmailPage";
import { VerifySuccessPage } from "@/components/auth/VerifySuccessPage";
import { VerifyPendingPage } from "@/components/auth/VerifyPendingPage";
import { SessionExpiredPage } from "@/components/errors/SessionExpiredPage";
import { UnauthorizedPage } from "@/components/errors/UnauthorizedPage";
import { NotFoundPage } from "@/components/errors/NotFoundPage";
import { InternalServerErrorPage } from "@/components/errors/InternalServerErrorPage";
import { PagePlaceholder } from "./pages/PagePlaceholder";
import { LoadingState } from "@/components/ui/state";

// ─── Lazy‑load all dashboard pages (code splitting) ─────────────────
const LandingPage = lazy(() => import("@/components/landing/LandingPage").then((m) => ({ default: m.LandingPage })));
const DashboardOverviewPage = lazy(() => import("@/pages/dashboard/DashboardOverviewPage").then((m) => ({ default: m.DashboardOverviewPage })));
const TasksPage = lazy(() => import("@/pages/dashboard/TasksPage").then((m) => ({ default: m.TasksPage })));
const SubscriptionPage = lazy(() => import("@/pages/dashboard/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })));
const BillingPage = lazy(() => import("@/pages/dashboard/BillingPage").then((m) => ({ default: m.BillingPage })));
const ProfilePage = lazy(() => import("@/pages/dashboard/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const SecurityPage = lazy(() => import("@/pages/dashboard/SecurityPage").then((m) => ({ default: m.SecurityPage })));
const AppearancePage = lazy(() => import("@/pages/dashboard/AppearancePage").then((m) => ({ default: m.AppearancePage })));
const NotificationsPage = lazy(() => import("@/pages/dashboard/NotificationsPage").then((m) => ({ default: m.NotificationsPage })));
const HelpCenterPage = lazy(() => import("@/pages/dashboard/HelpCenterPage").then((m) => ({ default: m.HelpCenterPage })));
const ContactSupportPage = lazy(() => import("@/pages/dashboard/ContactSupportPage").then((m) => ({ default: m.ContactSupportPage })));
const ExtractMembersPage = lazy(() => import("@/pages/dashboard/extraction/ExtractMembersPage").then((m) => ({ default: m.ExtractMembersPage })));
const ExtractContactsPage = lazy(() => import("@/pages/dashboard/extraction/ExtractContactsPage").then((m) => ({ default: m.ExtractContactsPage })));
const MessengerBroadcastPage = lazy(() => import("@/pages/dashboard/messenger/MessengerBroadcastPage").then((m) => ({ default: m.MessengerBroadcastPage })));
const GroupsPage = lazy(() => import("@/pages/dashboard/groups/GroupsPage").then((m) => ({ default: m.GroupsPage })));
const SessionsPage = lazy(() => import("@/pages/dashboard/SessionsPage").then((m) => ({ default: m.SessionsPage })));
const ConnectionWizardPage = lazy(() => import("@/pages/dashboard/ConnectionWizardPage").then((m) => ({ default: m.ConnectionWizardPage })));
const SessionErrorPage = lazy(() => import("@/pages/dashboard/SessionErrorPage").then((m) => ({ default: m.SessionErrorPage })));
const WaSessionsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaSessionsPage").then((m) => ({ default: m.WaSessionsPage })));
const WaConnectNumberPage = lazy(() => import("@/pages/dashboard/whatsapp/WaConnectNumberPage").then((m) => ({ default: m.WaConnectNumberPage })));
const WaSessionDetailsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaSessionDetailsPage").then((m) => ({ default: m.WaSessionDetailsPage })));
const WaInboxPage = lazy(() => import("@/pages/dashboard/whatsapp/WaInboxPage").then((m) => ({ default: m.WaInboxPage })));
const WaContactsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaContactsPage").then((m) => ({ default: m.WaContactsPage })));
const WaCampaignsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaCampaignsPage").then((m) => ({ default: m.WaCampaignsPage })));
const WaAutomationPage = lazy(() => import("@/pages/dashboard/whatsapp/WaAutomationPage").then((m) => ({ default: m.WaAutomationPage })));
const WaAIAgentPage = lazy(() => import("@/pages/dashboard/whatsapp/WaAIAgentPage").then((m) => ({ default: m.WaAIAgentPage })));
const WaTemplatesPage = lazy(() => import("@/pages/dashboard/whatsapp/WaTemplatesPage").then((m) => ({ default: m.WaTemplatesPage })));
const WaAnalyticsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaAnalyticsPage").then((m) => ({ default: m.WaAnalyticsPage })));
const WaSettingsPage = lazy(() => import("@/pages/dashboard/whatsapp/WaSettingsPage").then((m) => ({ default: m.WaSettingsPage })));
const AdminUsersPage = lazy(() => import("@/pages/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const AdminPlansPage = lazy(() => import("@/pages/admin/AdminPlansPage").then((m) => ({ default: m.AdminPlansPage })));
const AdminSettingsPage = lazy(() => import("@/pages/admin/AdminSettingsPage").then((m) => ({ default: m.AdminSettingsPage })));
const AdminOverviewPage = lazy(() => import("@/pages/admin/AdminOverviewPage").then((m) => ({ default: m.AdminOverviewPage })));
const AdminSubscriptionsPage = lazy(() => import("@/pages/admin/AdminSubscriptionsPage").then((m) => ({ default: m.AdminSubscriptionsPage })));
const AdminAuditLogsPage = lazy(() => import("@/pages/admin/AdminAuditLogsPage").then((m) => ({ default: m.AdminAuditLogsPage })));
const AdminNotificationsPage = lazy(() => import("@/pages/admin/AdminNotificationsPage").then((m) => ({ default: m.AdminNotificationsPage })));
const AdminAiProvidersPage = lazy(() => import("@/pages/admin/AdminAiProvidersPage").then((m) => ({ default: m.AdminAiProvidersPage })));
const AdminProfilePage = lazy(() => import("@/pages/admin/AdminProfilePage").then((m) => ({ default: m.AdminProfilePage })));
const AdminSecurityPage = lazy(() => import("@/pages/admin/AdminSecurityPage").then((m) => ({ default: m.AdminSecurityPage })));

const withSuspense = (node: React.ReactNode) => (
  <Suspense fallback={<LoadingState className="min-h-[50vh]" />}>{node}</Suspense>
);

const ph = (title: string) => <PagePlaceholder title={title} />;

function SessionErrorPageWrapper() {
  const { type } = useParams();
  return <SessionErrorPage type={(type as "expired" | "lost" | "auth" | "network") ?? "expired"} />;
}

export const router = createBrowserRouter([
  { path: "/", element: withSuspense(<LandingPage />) },
  {
    element: <PublicLayout />, children: [
      { path: "/about", element: ph("About") },
    ],
  },
  {
    path: "/auth", element: <GuestOnly />, children: [
      { element: <AuthLayout />, children: [
        { path: "login", element: <LoginPage /> }, { path: "register", element: <RegisterPage /> },
        { path: "forgot-password", element: <ForgotPasswordPage /> }, { path: "reset-password", element: <ResetPasswordPage /> },
        { path: "verify-email", element: <VerifyEmailPage /> }, { path: "verify-success", element: <VerifySuccessPage /> },
        { path: "verify-pending", element: <VerifyPendingPage /> },
      ]},
    ],
  },
  { path: "/session-expired", element: <SessionExpiredPage /> },
  {
    path: "/dashboard", element: <RequireAuth allowed={["user"]} />, children: [
      { element: <DashboardLayout />, children: [
        { index: true, element: withSuspense(<DashboardOverviewPage />) },
        { path: "facebook/extract-members", element: withSuspense(<ExtractMembersPage />) },
        { path: "facebook/messenger-contacts", element: withSuspense(<ExtractContactsPage />) },
        { path: "messenger/broadcast/:jobId", element: withSuspense(<MessengerBroadcastPage />) },
        { path: "facebook/groups", element: withSuspense(<GroupsPage />) },
        { path: "facebook/sessions", element: withSuspense(<SessionsPage />) },
        { path: "facebook/sessions/connect", element: withSuspense(<ConnectionWizardPage />) },
        { path: "facebook/sessions/error/:type", element: withSuspense(<SessionErrorPageWrapper />) },
        { path: "whatsapp", element: withSuspense(<WaSessionsPage />) },
        { path: "whatsapp/sessions", element: withSuspense(<WaSessionsPage />) },
        { path: "whatsapp/connect", element: withSuspense(<WaConnectNumberPage />) },
        { path: "whatsapp/sessions/:id", element: withSuspense(<WaSessionDetailsPage />) },
        { path: "whatsapp/inbox", element: withSuspense(<WaInboxPage />) },
        { path: "whatsapp/contacts", element: withSuspense(<WaContactsPage />) },
        { path: "whatsapp/campaigns", element: withSuspense(<WaCampaignsPage />) },
        { path: "whatsapp/automation", element: withSuspense(<WaAutomationPage />) },
        { path: "whatsapp/ai-agent", element: withSuspense(<WaAIAgentPage />) },
        { path: "whatsapp/templates", element: withSuspense(<WaTemplatesPage />) },
        { path: "whatsapp/analytics", element: withSuspense(<WaAnalyticsPage />) },
        { path: "whatsapp/settings", element: withSuspense(<WaSettingsPage />) },
        { path: "tasks", element: withSuspense(<TasksPage />) },
        { path: "subscription", element: withSuspense(<SubscriptionPage />) },
        { path: "billing", element: withSuspense(<BillingPage />) },
        { path: "profile", element: withSuspense(<ProfilePage />) },
        { path: "security", element: withSuspense(<SecurityPage />) },
        { path: "settings/appearance", element: withSuspense(<AppearancePage />) },
        { path: "settings/notifications", element: withSuspense(<NotificationsPage />) },
        { path: "support", element: withSuspense(<HelpCenterPage />) },
        { path: "support/contact", element: withSuspense(<ContactSupportPage />) },
        { path: "support/faq", element: ph("FAQ") },
        { path: "support/report", element: ph("Report Issue") },
        { path: "support/changelog", element: ph("Changelog") },
        { path: "profile/info", element: ph("Account Info") },
        { path: "profile/password", element: ph("Change Password") },
        { path: "profile/api-keys", element: ph("API Keys") },
        { path: "profile/webhooks", element: ph("Webhooks") },
        { path: "security/devices", element: ph("Devices") },
        { path: "settings/preferences", element: ph("Preferences") },
        { path: "subscription/usage", element: ph("Usage") },
        { path: "subscription/upgrade", element: ph("Upgrade") },
        { path: "billing/payment-methods", element: ph("Payment Methods") },
      ]},
    ],
  },
  {
    path: "/admin", element: <RoleGuard allowed={["admin", "super_admin"]} />, children: [
      { element: <AdminLayout />, children: [
        { index: true, element: withSuspense(<AdminOverviewPage />) },
        { path: "users", element: withSuspense(<AdminUsersPage />) },
        { path: "plans", element: withSuspense(<AdminPlansPage />) },
        { path: "subscriptions", element: withSuspense(<AdminSubscriptionsPage />) },
        { path: "settings", element: withSuspense(<AdminSettingsPage />) },
        { path: "audit-logs", element: withSuspense(<AdminAuditLogsPage />) },
        { path: "ai-providers", element: withSuspense(<AdminAiProvidersPage />) },
        { path: "security", element: withSuspense(<AdminSecurityPage />) },
        { path: "profile", element: withSuspense(<AdminProfilePage />) },
        { path: "notifications", element: withSuspense(<AdminNotificationsPage />) },
        { path: "support", element: ph("Support") },
      ]},
    ],
  },
  { path: "/403", element: <UnauthorizedPage /> },
  { path: "/500", element: <InternalServerErrorPage /> },
  { path: "*", element: <NotFoundPage /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}

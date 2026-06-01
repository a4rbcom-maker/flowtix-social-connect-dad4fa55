import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/notifications")({ ssr: false, component: NotificationsPage });

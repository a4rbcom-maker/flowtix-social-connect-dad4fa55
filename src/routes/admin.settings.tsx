import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/settings")({ ssr: false, component: SettingsPage });

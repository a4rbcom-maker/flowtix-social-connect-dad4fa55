import { createFileRoute } from "@tanstack/react-router";
import { LogsPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/logs")({ ssr: false, component: LogsPage });

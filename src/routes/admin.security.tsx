import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/security")({ ssr: false, component: SecurityPage });

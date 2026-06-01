import { createFileRoute } from "@tanstack/react-router";
import { FacebookPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/facebook")({ ssr: false, component: FacebookPage });

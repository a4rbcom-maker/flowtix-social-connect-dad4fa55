import { createFileRoute } from "@tanstack/react-router";
import { AiPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/ai")({ ssr: false, component: AiPage });

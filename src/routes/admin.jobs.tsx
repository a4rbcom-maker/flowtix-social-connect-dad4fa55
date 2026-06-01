import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/jobs")({ ssr: false, component: JobsPage });

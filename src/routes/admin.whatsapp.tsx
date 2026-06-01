import { createFileRoute } from "@tanstack/react-router";
import { WhatsappPage } from "@/components/admin/PlaceholderPages";
export const Route = createFileRoute("/admin/whatsapp")({ ssr: false, component: WhatsappPage });

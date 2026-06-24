import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/facebook/campaigns")({
  ssr: false,
  component: CampaignsLayout,
});

function CampaignsLayout() {
  return <Outlet />;
}

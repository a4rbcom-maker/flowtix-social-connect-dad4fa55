import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/whatsapp")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/dashboard/whatsapp" || location.pathname === "/dashboard/whatsapp/") {
      throw redirect({ to: "/dashboard/whatsapp/inbox" });
    }
  },
  component: () => <Outlet />,
});

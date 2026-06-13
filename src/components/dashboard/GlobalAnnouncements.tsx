// Mounts the AnnouncementModal app-wide (any authenticated user, any route)
// so platform announcements reach users wherever they are — not only inside
// /dashboard/*. Gated by useAuth to avoid 401s on public pages.
import { useAuth } from "@/lib/auth";
import { AnnouncementModal } from "@/components/dashboard/AnnouncementModal";

export function GlobalAnnouncements() {
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  return <AnnouncementModal />;
}

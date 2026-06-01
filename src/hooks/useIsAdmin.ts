import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin.functions";
import { useAuth } from "@/lib/auth";

export function useIsAdmin() {
  const { user } = useAuth();
  const fn = useServerFn(checkIsAdmin);
  const { data, isLoading } = useQuery({
    queryKey: ["is-admin", user?.id ?? "anon"],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  return { isAdmin: !!data?.isAdmin, isLoading };
}

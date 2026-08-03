import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PublicPlan {
  id: string; key: string; name: string; description: string;
  price_cents: number; currency: string; plan_interval: string;
  trial_days: number; features: string[]; is_popular: boolean;
  sort_order: number;
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ["public-plans"],
    queryFn: async (): Promise<PublicPlan[]> => {
      const { data, error } = await (supabase as any).rpc("list_public_plans");
      if (error) throw new Error(error.message);
      return (data ?? []).map((p: any) => ({
        ...p,
        features: Array.isArray(p.features) ? p.features : [],
        plan_interval: p.plan_interval ?? "monthly",
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
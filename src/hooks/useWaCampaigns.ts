import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { waCampaignsRepository } from "@/lib/wa-campaigns";
import { useAuth } from "@/lib/authProvider";
import type { WaCampaignStatus } from "@/types/wa-campaigns.types";

const CAMPAIGNS_KEY = "wa-campaigns";
const TEMPLATES_KEY = "wa-templates";

export function useWaCampaigns(status?: WaCampaignStatus) {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id; const qc = useQueryClient();
  const q = useQuery({
    queryKey: [CAMPAIGNS_KEY, ws, status],
    queryFn: () => ws ? waCampaignsRepository.list(ws, status) : Promise.resolve([]),
    enabled: !!ws,
  });
  useEffect(() => {
    if (!ws) return;
    const ch = supabase.channel(`wa-camp-${ws}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_campaigns", filter: `user_id=eq.${ws}` }, () => qc.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ws, qc]);
  return q;
}

export function useWaCampaignMutations() {
  const qc = useQueryClient(); const inv = () => qc.invalidateQueries({ queryKey: [CAMPAIGNS_KEY] });
  const create = useMutation({ mutationFn: (i: Parameters<typeof waCampaignsRepository.create>[0]) => waCampaignsRepository.create(i), onSuccess: inv });
  const control = useMutation({ mutationFn: ({ id, action }: { id: string; action: "start" | "pause" | "resume" | "stop" }) => waCampaignsRepository.control(id, action), onSuccess: inv });
  return { create, control };
}

export function useWaTemplates() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [TEMPLATES_KEY, ws], queryFn: () => ws ? waCampaignsRepository.listTemplates(ws) : Promise.resolve([]), enabled: !!ws });
  useEffect(() => {
    if (!ws) return;
    const ch = supabase.channel(`wa-tpl-${ws}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_templates", filter: `user_id=eq.${ws}` }, () => qc.invalidateQueries({ queryKey: [TEMPLATES_KEY] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ws, qc]);
  return q;
}

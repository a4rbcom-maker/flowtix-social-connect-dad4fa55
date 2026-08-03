import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waAiRepository } from "@/lib/wa-ai";
import { useAuth } from "@/lib/authProvider";

const CFG = "wa-ai-config", INV = "wa-ai-invocations", INS = "wa-ai-instructions";

export function useWaAiConfig() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  return useQuery({ queryKey: [CFG, ws], queryFn: () => ws ? waAiRepository.getConfig(ws) : Promise.resolve(null), enabled: !!ws });
}
export function useWaAiInstructions() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  return useQuery({ queryKey: [INS, ws], queryFn: () => ws ? waAiRepository.listInstructions(ws) : Promise.resolve([]), enabled: !!ws });
}
export function useWaAiInvocations(limit = 100) {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  return useQuery({ queryKey: [INV, ws, limit], queryFn: () => ws ? waAiRepository.listInvocations(ws, limit) : Promise.resolve([]), enabled: !!ws });
}
export function useWaAiMutations() {
  const qc = useQueryClient(); const { session: authSession } = useAuth(); const ws = authSession?.user?.id || "";
  const invCfg = () => qc.invalidateQueries({ queryKey: [CFG] });
  const invIns = () => qc.invalidateQueries({ queryKey: [INS] });
  return {
    saveConfig: useMutation({ mutationFn: (i: Omit<Parameters<typeof waAiRepository.saveConfig>[1], "apiKey"> & { apiKey?: string }) => waAiRepository.saveConfig(ws, { ...i }), onSuccess: invCfg }),
    testConfig: useMutation({ mutationFn: () => waAiRepository.testConfig(ws) }),
    saveInstructions: useMutation({ mutationFn: (i: Parameters<typeof waAiRepository.saveInstructions>[0]) => waAiRepository.saveInstructions(i), onSuccess: invIns }),
    deleteInstructions: useMutation({ mutationFn: (id: string) => waAiRepository.deleteInstructions(id), onSuccess: invIns }),
  };
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waAutomationRepository } from "@/lib/wa-automation";
import { useAuth } from "@/lib/authProvider";

const RULES_KEY = "wa-keyword-rules";
const WORKFLOWS_KEY = "wa-workflows";
const STEPS_KEY = "wa-workflow-steps";

export function useWaKeywordRules() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  return useQuery({ queryKey: [RULES_KEY, ws], queryFn: () => ws ? waAutomationRepository.listRules(ws) : Promise.resolve([]), enabled: !!ws });
}
export function useWaWorkflows() {
  const { session: authSession } = useAuth(); const ws = authSession?.user?.id;
  return useQuery({ queryKey: [WORKFLOWS_KEY, ws], queryFn: () => ws ? waAutomationRepository.listWorkflows(ws) : Promise.resolve([]), enabled: !!ws });
}
export function useWaWorkflowSteps(workflowId: string | undefined) {
  return useQuery({ queryKey: [STEPS_KEY, workflowId], queryFn: () => waAutomationRepository.listSteps(workflowId!), enabled: !!workflowId });
}
export function useWaAutomationMutations() {
  const qc = useQueryClient();
  const invRules = () => qc.invalidateQueries({ queryKey: [RULES_KEY] });
  const invWf = () => qc.invalidateQueries({ queryKey: [WORKFLOWS_KEY] });
  const invSteps = (id: string) => qc.invalidateQueries({ queryKey: [STEPS_KEY, id] });
  return {
    saveRule: useMutation({ mutationFn: (i: Parameters<typeof waAutomationRepository.saveRule>[0]) => waAutomationRepository.saveRule(i), onSuccess: invRules }),
    deleteRule: useMutation({ mutationFn: (id: string) => waAutomationRepository.deleteRule(id), onSuccess: invRules }),
    toggleRule: useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => waAutomationRepository.toggleRule(id, active), onSuccess: invRules }),
    saveWorkflow: useMutation({ mutationFn: (i: Parameters<typeof waAutomationRepository.saveWorkflow>[0]) => waAutomationRepository.saveWorkflow(i), onSuccess: invWf }),
    deleteWorkflow: useMutation({ mutationFn: (id: string) => waAutomationRepository.deleteWorkflow(id), onSuccess: invWf }),
    saveStep: useMutation({ mutationFn: (i: Parameters<typeof waAutomationRepository.saveStep>[0]) => waAutomationRepository.saveStep(i), onSuccess: (_d, v) => invSteps(v.workflowId) }),
    deleteStep: useMutation({ mutationFn: async ({ id, wfId }: { id: string; wfId: string }) => { await waAutomationRepository.deleteStep(id); return wfId; }, onSuccess: (wfId) => invSteps(wfId) }),
    reorderSteps: useMutation({ mutationFn: ({ wfId, ids }: { wfId: string; ids: string[] }) => waAutomationRepository.reorderSteps(wfId, ids), onSuccess: (_d, v) => invSteps(v.wfId) }),
  };
}

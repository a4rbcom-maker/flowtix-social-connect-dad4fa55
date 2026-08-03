import { supabase } from "@/lib/supabase";
import type { WaKeywordRule, WaWorkflow, WaWorkflowStep, WaAutomationStatus } from "@/types/wa-automation.types";

export const waAutomationRepository = {
  async listRules(workspaceId: string): Promise<WaKeywordRule[]> {
    const { data, error } = await (supabase as any).from("wa_keyword_rules").select("*").eq("workspace_id", workspaceId).order("priority");
    if (error) throw error; return data ?? [];
  },
  async saveRule(input: Partial<WaKeywordRule> & { workspaceId: string }): Promise<void> {
    const { workspaceId, ...rest } = input;
    const payload = { ...rest, action: "reply", workflow_id: null, reply_template_id: null };
    if (rest.id) { await (supabase as any).from("wa_keyword_rules").update(payload).eq("id", rest.id); }
    else { await (supabase as any).from("wa_keyword_rules").insert({ workspace_id: workspaceId, ...payload }); }
  },
  async deleteRule(id: string): Promise<void> { await (supabase as any).from("wa_keyword_rules").delete().eq("id", id); },
  async toggleRule(id: string, active: boolean): Promise<void> { await (supabase as any).from("wa_keyword_rules").update({ is_active: active }).eq("id", id); },

  async listWorkflows(workspaceId: string): Promise<WaWorkflow[]> {
    const { data, error } = await (supabase as any).from("wa_workflows").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    if (error) throw error; return data ?? [];
  },
  async saveWorkflow(input: { workspaceId: string; id?: string; name: string; description?: string; trigger: unknown; status?: WaAutomationStatus }): Promise<string> {
    if (input.id) { await (supabase as any).from("wa_workflows").update({ name: input.name, description: input.description, trigger: input.trigger, status: input.status }).eq("id", input.id); return input.id; }
    const { data, error } = await (supabase as any).from("wa_workflows").insert({ workspace_id: input.workspaceId, name: input.name, description: input.description, trigger: input.trigger, status: input.status ?? "draft" }).select("id").single();
    if (error) throw error; return data.id;
  },
  async deleteWorkflow(id: string): Promise<void> { await (supabase as any).from("wa_workflows").delete().eq("id", id); },

  async listSteps(workflowId: string): Promise<WaWorkflowStep[]> {
    const { data, error } = await (supabase as any).from("wa_workflow_steps").select("*").eq("workflow_id", workflowId).order("sort_order");
    if (error) throw error; return data ?? [];
  },
  async saveStep(input: { workspaceId: string; workflowId: string; step_type: string; config: unknown; sortOrder: number; id?: string }): Promise<void> {
    if (input.id) { await (supabase as any).from("wa_workflow_steps").update({ config: input.config, sort_order: input.sortOrder }).eq("id", input.id); }
    else { await (supabase as any).from("wa_workflow_steps").insert({ workspace_id: input.workspaceId, workflow_id: input.workflowId, step_type: input.step_type, config: input.config, sort_order: input.sortOrder }); }
  },
  async reorderSteps(_workflowId: string, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) { await (supabase as any).from("wa_workflow_steps").update({ sort_order: i }).eq("id", orderedIds[i]); }
  },
  async deleteStep(id: string): Promise<void> { await (supabase as any).from("wa_workflow_steps").delete().eq("id", id); },
};

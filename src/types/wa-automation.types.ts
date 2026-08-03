import type { Database } from "./database.types";

export type WaKeywordRule = Database["public"]["Tables"]["wa_keyword_rules"]["Row"];
export type WaWorkflow = Database["public"]["Tables"]["wa_workflows"]["Row"];
export type WaWorkflowStep = Database["public"]["Tables"]["wa_workflow_steps"]["Row"];
export type WaMatchType = Database["public"]["Enums"]["wa_match_type"];
export type WaAutomationStatus = Database["public"]["Enums"]["wa_automation_status"];

export interface StepConfig {
  text?: string; delay_sec?: number; buttons?: { id: string; title: string }[];
  condition?: { field: string; op: string; value: string };
  api?: { url: string; method: string; body?: unknown };
}

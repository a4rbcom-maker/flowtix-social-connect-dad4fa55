import { supabase } from "@/lib/supabase";

export interface AiModel {
  id: string;
  model_id: string;
  provider: string;
  display_name: Record<string, string>;
  description: Record<string, string>;
  is_active: boolean;
  is_premium: boolean;
  sort_order: number;
  cost_per_1k_tokens: number | null;
}

export const waAiModelsRepository = {
  async listActive(): Promise<AiModel[]> {
    const { data, error } = await (supabase as any)
      .from("ai_models")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiModel[];
  },

  async listAll(): Promise<AiModel[]> {
    const { data, error } = await (supabase as any)
      .from("ai_models")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiModel[];
  },

  async save(input: Partial<AiModel> & { id?: string }): Promise<void> {
    if (input.id) {
      await (supabase as any).from("ai_models").update(input).eq("id", input.id);
    } else {
      await (supabase as any).from("ai_models").insert(input as any);
    }
  },

  async delete(id: string): Promise<void> {
    await (supabase as any).from("ai_models").delete().eq("id", id);
  },

  async toggleActive(id: string, isActive: boolean): Promise<void> {
    await (supabase as any).from("ai_models").update({ is_active: isActive }).eq("id", id);
  },
};

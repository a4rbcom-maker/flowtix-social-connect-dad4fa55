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

const ACTIVE_COLUMNS = "model_id, provider, display_name, description, is_premium, sort_order";
const ADMIN_COLUMNS = "id, is_active, sort_order, model_id, provider, display_name, description, is_premium";

export const waAiModelsRepository = {
  async listActive(): Promise<AiModel[]> {
    const { data, error } = await supabase
      .from("ai_models" as any)
      .select(ACTIVE_COLUMNS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as AiModel[];
  },

  async listAll(): Promise<AiModel[]> {
    const { data, error } = await supabase
      .from("ai_models" as any)
      .select(ADMIN_COLUMNS)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as AiModel[];
  },

  async save(input: Partial<AiModel> & { id?: string }): Promise<void> {
    const { id, ...fields } = input;
    if (id) {
      await supabase.from("ai_models" as any).update(fields).eq("id", id);
    } else {
      await supabase.from("ai_models" as any).insert(fields as any);
    }
  },

  async delete(id: string): Promise<void> {
    await supabase.from("ai_models" as any).delete().eq("id", id);
  },

  async toggleActive(id: string, isActive: boolean): Promise<void> {
    await supabase.from("ai_models" as any).update({ is_active: isActive }).eq("id", id);
  },
};

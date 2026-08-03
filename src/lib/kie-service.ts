import { supabase } from "@/lib/supabase";

const KIE_API = "https://api.kie.ai/api/v1/chat/credit";

export interface AiProviderAccount {
  id: string;
  name: string;
  api_key_enc: string;
  provider: string;
  credits: number;
  is_active: boolean;
  priority: number;
  last_checked_at: string | null;
}

// أخطاء معروفة برموز مميزة لعرضها بشكل أفضل في الواجهة
export class DuplicateApiKeyError extends Error {
  constructor() {
    super("api_key_already_exists");
    this.name = "DuplicateApiKeyError";
  }
}

export class InvalidApiKeyError extends Error {
  constructor() {
    super("invalid_api_key");
    this.name = "InvalidApiKeyError";
  }
}

function parseCredits(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(n, 0);
}

function isDuplicateKeyError(error: any): boolean {
  const msg = String(error?.message ?? "");
  return (
    msg.includes("api_key_uniq") ||
    msg.includes("duplicate key value") ||
    msg.includes("23505")
  );
}

export const kieService = {
  async checkCredits(apiKey: string): Promise<number> {
    const res = await fetch(KIE_API, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status === 401 || res.status === 403) throw new InvalidApiKeyError();
    if (!res.ok) throw new Error(`Kie.ai error: ${res.status}`);
    const json = await res.json();
    return parseCredits(json.data);
  },

  async listAccounts(workspaceId: string): Promise<AiProviderAccount[]> {
    const { data, error } = await (supabase as any)
      .from("ai_provider_accounts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority");
    if (error) throw error;
    return data ?? [];
  },

  async isApiKeyUsed(apiKey: string): Promise<boolean> {
    const trimmed = apiKey.trim();
    if (!trimmed) return false;
    const { data, error } = await (supabase as any)
      .from("ai_provider_accounts")
      .select("id")
      .eq("api_key_enc", trimmed)
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  },

  async addAccount(workspaceId: string, name: string, apiKey: string, priority: number): Promise<AiProviderAccount> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) throw new Error("api_key_required");

    // فحص التكرار على مستوى التطبيق (قبل طلب الشبكة) لتجربة أفضل
    const alreadyUsed = await this.isApiKeyUsed(trimmedKey);
    if (alreadyUsed) throw new DuplicateApiKeyError();

    // التحقق من صحة المفتاح وجلب الرصيد
    let credits = 0;
    try {
      credits = await this.checkCredits(trimmedKey);
    } catch (e) {
      if (e instanceof InvalidApiKeyError) throw e;
      // لو فشل فحص الرصيد لسبب شبكي، نتابع الإضافة برصيد 0
      credits = 0;
    }

    const { data, error } = await (supabase as any)
      .from("ai_provider_accounts")
      .insert({
        workspace_id: workspaceId,
        name: name.trim(),
        api_key_enc: trimmedKey,
        provider: "kie",
        credits,
        priority: priority || 0,
        is_active: true,
        last_checked_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      // حماية إضافية: لو سبق أن أُضيف بين الفحص والإدراج (race condition)
      if (isDuplicateKeyError(error)) throw new DuplicateApiKeyError();
      throw error;
    }
    return data;
  },

  async updateAccount(id: string, updates: { name?: string; is_active?: boolean; priority?: number; api_key_enc?: string }): Promise<AiProviderAccount> {
    const updateData: any = { ...updates, updated_at: new Date().toISOString() };

    if (updates.api_key_enc) {
      const trimmedKey = updates.api_key_enc.trim();

      // فحص التكرار (مع استبعاد الصف الحالي)
      const { data: existing } = await (supabase as any)
        .from("ai_provider_accounts")
        .select("id")
        .eq("api_key_enc", trimmedKey)
        .neq("id", id)
        .maybeSingle();
      if (existing) throw new DuplicateApiKeyError();

      try {
        updateData.credits = await this.checkCredits(trimmedKey);
        updateData.last_checked_at = new Date().toISOString();
      } catch (e) {
        if (e instanceof InvalidApiKeyError) throw e;
      }
    }

    const { data, error } = await (supabase as any)
      .from("ai_provider_accounts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (isDuplicateKeyError(error)) throw new DuplicateApiKeyError();
      throw error;
    }
    return data;
  },

  async deleteAccount(id: string): Promise<void> {
    const { error } = await (supabase as any).from("ai_provider_accounts").delete().eq("id", id);
    if (error) throw error;
  },

  async refreshAllCredits(workspaceId: string): Promise<AiProviderAccount[]> {
    const accounts = await this.listAccounts(workspaceId);
    const updated = await Promise.all(
      accounts.map(async (a) => {
        try {
          const credits = await this.checkCredits(a.api_key_enc);
          const { data } = await (supabase as any)
            .from("ai_provider_accounts")
            .update({ credits, last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", a.id)
            .select()
            .single();
          return data ?? { ...a, credits };
        } catch {
          return a;
        }
      }),
    );
    return updated;
  },

  async getActiveAccount(workspaceId: string): Promise<AiProviderAccount> {
    const accounts = await this.listAccounts(workspaceId);
    const active = accounts.filter((a) => a.is_active);
    for (const a of active) {
      try {
        const credits = await this.checkCredits(a.api_key_enc);
        if (credits > 0) {
          await (supabase as any)
            .from("ai_provider_accounts")
            .update({ credits, last_checked_at: new Date().toISOString() })
            .eq("id", a.id);
          return { ...a, credits };
        }
      } catch {
        continue;
      }
    }
    throw new Error("لا توجد حسابات بها رصيد متاح");
  },
};

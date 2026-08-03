import { supabase } from "@/lib/supabase";
import type {
  FbBrowserProfile,
  FbBrowserProfileInsert,
  FbBrowserProfileUpdate,
} from "@/types/fb-sessions.types";

// ============================================================
// Browser Profile Service
// Manages browser profiles for Facebook sessions.
// Each session has exactly one browser profile (1:1).
// ============================================================

export const browserProfileService = {
  // Get the browser profile for a session
  async getBySessionId(sessionId: string): Promise<FbBrowserProfile | null> {
    const { data, error } = await supabase
      .from("fb_browser_profiles")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  // Create a browser profile for a session
  async create(input: FbBrowserProfileInsert): Promise<FbBrowserProfile> {
    if (!input.profile_name?.trim()) {
      throw new Error("Profile name is required");
    }

    const { data, error } = await supabase
      .from("fb_browser_profiles")
      .insert({
        session_id: input.session_id,
        user_id: input.user_id,
        profile_name: input.profile_name.trim(),
        profile_path: input.profile_path ?? null,
        profile_data: (input.profile_data ?? {}) as never,
        cookies_enc: input.cookies_enc ?? null,
        user_agent: input.user_agent ?? null,
        viewport_width: input.viewport_width ?? 1280,
        viewport_height: input.viewport_height ?? 720,
        timezone: input.timezone ?? null,
        locale: input.locale ?? "en-US",
        is_incognito: input.is_incognito ?? false,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update a browser profile
  async update(sessionId: string, updates: FbBrowserProfileUpdate): Promise<FbBrowserProfile> {
    const { data, error } = await supabase
      .from("fb_browser_profiles")
      .update(updates as never)
      .eq("session_id", sessionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Delete a browser profile
  async delete(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from("fb_browser_profiles")
      .delete()
      .eq("session_id", sessionId);

    if (error) throw error;
  },

  // Update cookies for a browser profile
  async updateCookies(sessionId: string, cookiesEnc: string): Promise<void> {
    const { error } = await supabase
      .from("fb_browser_profiles")
      .update({ cookies_enc: cookiesEnc } as never)
      .eq("session_id", sessionId);

    if (error) throw error;
  },

  // Update profile metadata
  async updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    const { error } = await supabase
      .from("fb_browser_profiles")
      .update({ profile_data: metadata as never })
      .eq("session_id", sessionId);

    if (error) throw error;
  },

  // Get or create a browser profile for a session
  async getOrCreate(sessionId: string, userId: string, profileName: string): Promise<FbBrowserProfile> {
    const existing = await this.getBySessionId(sessionId);
    if (existing) return existing;

    return this.create({
      session_id: sessionId,
      user_id: userId,
      profile_name: profileName,
    });
  },
};

// User-facing announcement/notification server functions.
// Authenticated via requireSupabaseAuth — RLS on platform_announcements +
// notification_reads scopes data to the current user.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const EMPTY_NOTIFICATIONS = { rows: [], unreadCount: 0, popupId: null as string | null };

async function getNotificationAuth() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing Supabase environment variables");
  }

  const authHeader = getRequest()?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  return { supabase, userId };
}

// List active announcements targeted at the current user, with read-state joined.
export const getMyNotifications = createServerFn({ method: "GET" })
  .handler(async () => {
    const auth = await getNotificationAuth();
    if (!auth) return EMPTY_NOTIFICATIONS;

    const { supabase, userId } = auth;
    // RLS does the targeting filter for us. Pull all rows visible to the user.
    const { data: anns, error } = await supabase
      .from("platform_announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const ids = (anns ?? []).map((a) => a.id);
    let readsMap = new Map<string, {
      opened_at: string | null;
      read_at: string | null;
      ack_at: string | null;
      delivered_at: string;
    }>();
    if (ids.length) {
      const { data: reads } = await supabase
        .from("notification_reads")
        .select("announcement_id,delivered_at,opened_at,read_at,ack_at")
        .in("announcement_id", ids)
        .eq("user_id", userId);
      readsMap = new Map(
        (reads ?? []).map((r) => [r.announcement_id, {
          opened_at: r.opened_at,
          read_at: r.read_at,
          ack_at: r.ack_at,
          delivered_at: r.delivered_at,
        }]),
      );
    }

    const rows = (anns ?? []).map((a) => ({
      ...a,
      _read: readsMap.get(a.id) ?? null,
    }));
    const unreadCount = rows.filter((r) => !r._read?.read_at && !r._read?.ack_at).length;
    const popupCandidate = rows.find(
      (r) => r.show_as_popup && !r._read?.read_at && !r._read?.ack_at,
    );
    return { rows, unreadCount, popupId: popupCandidate?.id ?? null };
  });

// Mark delivered + opened (idempotent upsert).
export const markNotificationOpened = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { announcementId: string }) =>
    z.object({ announcementId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("notification_reads")
      .upsert(
        {
          announcement_id: data.announcementId,
          user_id: userId,
          delivered_at: now,
          opened_at: now,
        },
        { onConflict: "announcement_id,user_id", ignoreDuplicates: false },
      );
    if (error) throw new Error(error.message);
    // Then patch opened_at without overwriting existing values
    await supabase
      .from("notification_reads")
      .update({ opened_at: now })
      .eq("announcement_id", data.announcementId)
      .eq("user_id", userId)
      .is("opened_at", null);
    return { ok: true };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { announcementId: string; ack?: boolean }) =>
    z.object({ announcementId: z.string().uuid(), ack: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    // Ensure row exists
    await supabase
      .from("notification_reads")
      .upsert(
        {
          announcement_id: data.announcementId,
          user_id: userId,
          delivered_at: now,
          opened_at: now,
          read_at: now,
          ack_at: data.ack ? now : null,
        },
        { onConflict: "announcement_id,user_id", ignoreDuplicates: false },
      );
    const patch: { read_at: string; ack_at?: string } = { read_at: now };
    if (data.ack) patch.ack_at = now;
    const { error } = await supabase
      .from("notification_reads")
      .update(patch)
      .eq("announcement_id", data.announcementId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date().toISOString();
    // Get all currently visible (RLS-filtered) announcements
    const { data: anns } = await supabase
      .from("platform_announcements")
      .select("id,require_ack");
    if (!anns?.length) return { ok: true, count: 0 };

    // Upsert read rows for any not yet acknowledged.
    // Skip ones that REQUIRE ack — those need explicit confirmation.
    const targets = anns.filter((a) => !a.require_ack);
    if (!targets.length) return { ok: true, count: 0 };

    const rows = targets.map((a) => ({
      announcement_id: a.id,
      user_id: userId,
      delivered_at: now,
      opened_at: now,
      read_at: now,
    }));
    const { error } = await supabase
      .from("notification_reads")
      .upsert(rows, { onConflict: "announcement_id,user_id" });
    if (error) throw new Error(error.message);
    // Then patch read_at on any rows that already existed without read_at
    await supabase
      .from("notification_reads")
      .update({ read_at: now })
      .in("announcement_id", targets.map((a) => a.id))
      .eq("user_id", userId)
      .is("read_at", null);
    return { ok: true, count: targets.length };
  });

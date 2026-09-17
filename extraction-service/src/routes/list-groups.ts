import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

const log = logger;
const router = Router();

const listGroupsSchema = z.object({ session_id: z.string().min(1) });

export interface ManagedGroup {
  id: string;
  name: string;
  picture_url: string;
  member_count: string;
  privacy: string;
  role: string;
  last_active: string;
  can_post: boolean;
}

router.post("/list-groups", async (req, res) => {
  try {
    const parsed = listGroupsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map(i => i.message).join(", ") } });
    }
    const { session_id } = parsed.data;
    log.info("ListGroups", `listing groups`);

    // Validate the session exists (fast DB check) — no browser context needed:
    // Facebook does not serve joined groups to web clients (probed 2026-09-01),
    // so the response is constant regardless of session state.
    await supabaseService.getSessionAndCookies(session_id);
    log.info("ListGroups", "groups not available for web clients (platform limitation)");
    return res.json({
      groups: [] as ManagedGroup[],
      notice: {
        code: ErrorCodes.GROUPS_NOT_AVAILABLE,
        message: "قائمة الجروبات غير متاحة للعميل الحالي. فيسبوك لا يسمح بالوصول للجروبات عبر الويب.",
        platform_limitation: true
      }
    });
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("ListGroups", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;

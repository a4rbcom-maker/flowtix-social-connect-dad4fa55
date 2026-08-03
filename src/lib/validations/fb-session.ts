import { z } from "zod";
import { VALID_TRANSITIONS, type FbSessionStatus } from "@/types/fb-sessions.types";

const ALLOWED_BROWSERS = ["Chrome", "Firefox", "Safari", "Edge"] as const;
  const ALLOWED_METHODS = ["browser", "qr", "cookie"] as const;

export const sessionNameSchema = z
  .string()
  .min(3, "يجب أن يتكون اسم الجلسة من 3 أحرف على الأقل.")
  .max(100, "يجب أن لا يتجاوز اسم الجلسة 100 حرف.")
  .regex(/^[^<>{}\\]*$/, "يحتوي اسم الجلسة على أحرف غير مسموحة.")
  .transform((v) => v.trim());

export const browserSchema = z
  .enum(ALLOWED_BROWSERS, { message: "متصفح غير صالح. المسموح: كروم، فايرفوكس، سفاري، إيدج" })
  .nullable()
  .optional();

export const connectionMethodSchema = z
  .enum(ALLOWED_METHODS, { message: "طريقة اتصال غير صالحة. المسموح: متصفح، رمز QR، كوكيز" })
  .nullable()
  .optional();

export const workspaceIdSchema = z
  .string()
  .uuid("صيغة معرّف مساحة العمل غير صالحة");

export const userIdSchema = z
  .string()
  .uuid("صيغة معرّف المستخدم غير صالحة");

export const sessionIdSchema = z
  .string()
  .uuid("صيغة معرّف الجلسة غير صالحة");

export const createSessionSchema = z.object({
  name: sessionNameSchema,
  browser: browserSchema,
  connectionMethod: connectionMethodSchema.default("browser"),
  fbName: z.string().max(200).nullable().optional(),
  fbUserId: z.string().max(100).nullable().optional(),
  fbAvatarUrl: z.string().url().nullable().optional(),
});

export const renameSessionSchema = z.object({
  name: sessionNameSchema,
});

export const updateSessionSchema = z.object({
  name: sessionNameSchema.optional(),
  browser: browserSchema,
  connectionMethod: connectionMethodSchema,
  fbName: z.string().nullable().optional(),
  fbUserId: z.string().nullable().optional(),
  fbAvatarUrl: z.string().url().nullable().optional(),
});

export const transitionSchema = z.object({
  sessionId: sessionIdSchema,
  newStatus: z.enum([
    "connected", "connecting", "disconnected",
    "expired", "paused", "error", "reconnecting",
  ] as const),
  reason: z.string().max(500).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RenameSessionInput = z.infer<typeof renameSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type TransitionInput = z.infer<typeof transitionSchema>;

export function validateCreateSession(input: unknown) {
  return createSessionSchema.safeParse(input);
}

export function validateRenameSession(input: unknown) {
  return renameSessionSchema.safeParse(input);
}

export function validateUpdateSession(input: unknown) {
  return updateSessionSchema.safeParse(input);
}

export function validateTransition(from: FbSessionStatus, to: FbSessionStatus): {
  valid: boolean;
  error: string | null;
} {
  if (from === to) return { valid: true, error: null };
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) {
    return { valid: false, error: `حالة غير معروفة: ${from}` };
  }
  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `انتقال غير صالح من "${from}" إلى "${to}". المسموح: ${allowed.join("، ")}`,
    };
  }
  return { valid: true, error: null };
}

export function validateWorkspace(workspaceId: string | null | undefined): {
  valid: boolean;
  error: string | null;
} {
  if (!workspaceId) return { valid: false, error: "مساحة العمل مفقودة" };
  const result = workspaceIdSchema.safeParse(workspaceId);
  if (!result.success) return { valid: false, error: "صيغة معرّف مساحة العمل غير صالحة" };
  return { valid: true, error: null };
}

export function validateOwner(userId: string | null | undefined): {
  valid: boolean;
  error: string | null;
} {
  if (!userId) return { valid: false, error: "المالك مفقود" };
  const result = userIdSchema.safeParse(userId);
  if (!result.success) return { valid: false, error: "صيغة معرّف المستخدم غير صالحة" };
  return { valid: true, error: null };
}

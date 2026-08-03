import { z } from "zod";
import { VALID_TRANSITIONS, type WaSessionStatus } from "@/types/wa.types";

const ALLOWED_PROVIDERS = ["baileys", "cloud_api"] as const;

export const sessionNameSchema = z
  .string()
  .min(3, "يجب أن يتكون اسم الجلسة من 3 أحرف على الأقل.")
  .max(100, "يجب أن لا يتجاوز اسم الجلسة 100 حرف.")
  .regex(/^[^<>{}\\]*$/, "يحتوي اسم الجلسة على أحرف غير مسموحة.")
  .transform((v) => v.trim());

export const providerTypeSchema = z
  .enum(ALLOWED_PROVIDERS, { message: "طريقة ربط غير صالحة. المسموح: baileys, cloud_api" })
  .nullable()
  .optional();

export const workspaceIdSchema = z.string().uuid("صيغة معرّف مساحة العمل غير صالحة");
export const userIdSchema = z.string().uuid("صيغة معرّف المستخدم غير صالحة");
export const sessionIdSchema = z.string().uuid("صيغة معرّف الجلسة غير صالحة");

export const createWaSessionSchema = z.object({
  name: sessionNameSchema,
  providerType: providerTypeSchema.default("baileys"),
  phoneNumber: z.string().max(30).nullable().optional(),
});

export const renameWaSessionSchema = z.object({
  name: sessionNameSchema,
});

export const transitionWaSchema = z.object({
  sessionId: sessionIdSchema,
  newStatus: z.enum([
    "disconnected", "qr_ready", "authenticating", "connecting",
    "connected", "reconnecting", "paused", "expired", "error",
  ] as const satisfies readonly WaSessionStatus[]),
  reason: z.string().max(500).optional(),
});

export type CreateWaSessionInput = z.infer<typeof createWaSessionSchema>;
export type RenameWaSessionInput = z.infer<typeof renameWaSessionSchema>;
export type TransitionWaInput = z.infer<typeof transitionWaSchema>;

export function validateCreateWaSession(input: unknown) {
  return createWaSessionSchema.safeParse(input);
}

export function validateRenameWaSession(input: unknown) {
  return renameWaSessionSchema.safeParse(input);
}

export function validateWaTransition(from: WaSessionStatus, to: WaSessionStatus): {
  valid: boolean; error: string | null;
} {
  if (from === to) return { valid: true, error: null };
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return { valid: false, error: `حالة غير معروفة: ${from}` };
  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `انتقال غير صالح من "${from}" إلى "${to}". المسموح: ${allowed.join("، ")}`,
    };
  }
  return { valid: true, error: null };
}

export function validateWorkspace(workspaceId: string | null | undefined) {
  if (!workspaceId) return { valid: false, error: "مساحة العمل مفقودة" };
  const r = workspaceIdSchema.safeParse(workspaceId);
  return r.success ? { valid: true, error: null } : { valid: false, error: "صيغة معرّف مساحة العمل غير صالحة" };
}

export function validateOwner(userId: string | null | undefined) {
  if (!userId) return { valid: false, error: "المالك مفقود" };
  const r = userIdSchema.safeParse(userId);
  return r.success ? { valid: true, error: null } : { valid: false, error: "صيغة معرّف المستخدم غير صالحة" };
}

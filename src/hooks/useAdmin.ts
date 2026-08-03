import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminRepository } from "@/lib/admin-repository";
import type { AdminUserFilters, AdminInviteUserInput, AdminPlanInput, AdminPlanUpdateInput, AdminSettingInput, AdminFeatureFlagInput, AdminFeatureFlagUpdateInput, AdminAuditLogFilters } from "@/types/admin.types";

export function useAdminUsers(filters: AdminUserFilters) {
  return useQuery({
    queryKey: ["admin-users", filters],
    queryFn: () => adminRepository.listUsers(filters),
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}
export function useAdminUser(userId: string | null) {
  return useQuery({
    queryKey: ["admin-user", userId ?? ""],
    queryFn: () => adminRepository.getUser(userId!),
    enabled: !!userId,
  });
}
export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, status, reason }: { userId: string; status: string; reason?: string }) => adminRepository.updateUserStatus(userId, status, reason),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user", v.userId] }); },
  });
}
export function useChangeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => adminRepository.changeUserRole(userId, role),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user", v.userId] }); },
  });
}
export function useSetUserPassword() {
  return useMutation({ mutationFn: ({ userId, password }: { userId: string; password: string }) => adminRepository.setUserPassword(userId, password) });
}
export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminInviteUserInput) => adminRepository.inviteUser(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
}

// ─── Plans ────────────────────────────────────────────────
export function useAdminPlans() {
  return useQuery({ queryKey: ["admin-plans"], queryFn: () => adminRepository.listPlans(), staleTime: 60 * 1000 });
}
export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: AdminPlanInput) => adminRepository.createPlan(input), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); } });
}
export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ planId, input }: { planId: string; input: AdminPlanUpdateInput }) => adminRepository.updatePlan(planId, input), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); } });
}
export function useTogglePlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ planId, isActive }: { planId: string; isActive: boolean }) => adminRepository.togglePlan(planId, isActive), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); } });
}
export function useReorderPlans() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (orders: Array<{ id: string; sort_order: number }>) => adminRepository.reorderPlans(orders), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); } });
}
export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (planId: string) => adminRepository.deletePlan(planId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-plans"] }); } });
}

// ─── System Settings ─────────────────────────────────────
export function useAdminSettings(category?: string) {
  return useQuery({
    queryKey: ["admin-settings", category ?? "all"],
    queryFn: () => adminRepository.listSettings(category),
    staleTime: 60 * 1000,
  });
}
export function useUpsertSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminSettingInput) => adminRepository.upsertSetting(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
  });
}
export function useDeleteSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => adminRepository.deleteSetting(key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
  });
}
export function useBulkUpsertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Array<AdminSettingInput>) => adminRepository.bulkUpsertSettings(settings),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-settings"] }); },
  });
}

// ─── Feature Flags ────────────────────────────────────────
export function useAdminFlags(category?: string) {
  return useQuery({
    queryKey: ["admin-flags", category ?? "all"],
    queryFn: () => adminRepository.listFlags(category),
    staleTime: 30 * 1000,
  });
}
export function useToggleFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, enabled }: { flagId: string; enabled: boolean }) => adminRepository.toggleFlag(flagId, enabled),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-flags"] }); },
  });
}
export function useCreateFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminFeatureFlagInput) => adminRepository.createFlag(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-flags"] }); },
  });
}
export function useUpdateFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, input }: { flagId: string; input: AdminFeatureFlagUpdateInput }) => adminRepository.updateFlag(flagId, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-flags"] }); },
  });
}
export function useDeleteFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flagId: string) => adminRepository.deleteFlag(flagId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-flags"] }); },
  });
}

// ─── Audit Logs ──────────────────────────────────────────
export function useAdminAuditLogs(filters: AdminAuditLogFilters) {
  return useQuery({
    queryKey: ["admin-audit-logs", filters],
    queryFn: () => adminRepository.listAuditLogs(filters),
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });
}
export function useAdminAuditLogCount(filters: AdminAuditLogFilters) {
  return useQuery({
    queryKey: ["admin-audit-logs-count", filters],
    queryFn: () => adminRepository.countAuditLogs(filters),
    staleTime: 30 * 1000,
  });
}
export function useAdminAuditStats() {
  return useQuery({
    queryKey: ["admin-audit-stats"],
    queryFn: () => adminRepository.getAuditStats(),
    staleTime: 60 * 1000,
  });
}
export function useAdminAuditTrend(days = 30) {
  return useQuery({
    queryKey: ["admin-audit-trend", days],
    queryFn: () => adminRepository.getAuditTrend(days),
    staleTime: 5 * 60 * 1000,
  });
}
export function useAdminAuditLog(logId: string | null) {
  return useQuery({
    queryKey: ["admin-audit-log", logId ?? ""],
    queryFn: () => adminRepository.getAuditLog(logId!),
    enabled: !!logId,
  });
}
export function useExportAuditLogs() {
  return useMutation({
    mutationFn: (filters: AdminAuditLogFilters) => adminRepository.exportAuditLogs(filters),
  });
}
// ─── Security Overview ──────────────────────────────────────
export function useAdminSecurityOverview() {
  return useQuery({
    queryKey: ["admin-security-overview"],
    queryFn: () => adminRepository.getSecurityOverview(),
    staleTime: 60 * 1000,
  });
}

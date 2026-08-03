import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waSettingsRepository } from "@/lib/wa-settings-repository";
import type { WaAutoReplySettings, WaBusinessHourDay, OutsideHoursAction, WaQuickReplyInput, QuickReplyCategory } from "@/types/wa-settings.types";

export function useWaAutoReplySettings() {
  return useQuery({ queryKey: ["wa-auto-reply"], queryFn: () => waSettingsRepository.getAutoReplySettings(), staleTime: 60 * 1000 });
}
export function useUpdateWaAutoReply() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: Partial<WaAutoReplySettings>) => waSettingsRepository.updateAutoReplySettings(input), onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-auto-reply"] }) });
}
export function useWaBusinessHours() {
  return useQuery({ queryKey: ["wa-business-hours"], queryFn: () => waSettingsRepository.getBusinessHours(), staleTime: 60 * 1000 });
}
export function useUpdateWaBusinessHours() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { is_enabled?: boolean; timezone?: string; schedule?: WaBusinessHourDay[]; outside_hours_action?: OutsideHoursAction; outside_hours_message?: string | null }) => waSettingsRepository.updateBusinessHours(input), onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-business-hours"] }) });
}
export function useWaQuickReplies(category?: QuickReplyCategory) {
  return useQuery({ queryKey: ["wa-quick-replies", category ?? "all"], queryFn: () => waSettingsRepository.listQuickReplies(category), staleTime: 30 * 1000 });
}
export function useCreateWaQuickReply() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: WaQuickReplyInput) => waSettingsRepository.createQuickReply(input), onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-quick-replies"] }) });
}
export function useUpdateWaQuickReply() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<WaQuickReplyInput> }) => waSettingsRepository.updateQuickReply(id, input), onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-quick-replies"] }) });
}
export function useDeleteWaQuickReply() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => waSettingsRepository.deleteQuickReply(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-quick-replies"] }) });
}

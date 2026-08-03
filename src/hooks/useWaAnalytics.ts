import { useQuery } from "@tanstack/react-query";
import { waAnalyticsRepository } from "@/lib/wa-analytics-repository";

export function useWaAnalyticsOverview(days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-overview", days],
    queryFn: () => waAnalyticsRepository.getOverview(days),
    staleTime: 60 * 1000,
  });
}
export function useWaMessageTrend(days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-trend", days],
    queryFn: () => waAnalyticsRepository.getMessageTrend(days),
    staleTime: 5 * 60 * 1000,
  });
}
export function useWaStatusDistribution(days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-status", days],
    queryFn: () => waAnalyticsRepository.getStatusDistribution(days),
    staleTime: 5 * 60 * 1000,
  });
}
export function useWaTypeDistribution(days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-type", days],
    queryFn: () => waAnalyticsRepository.getTypeDistribution(days),
    staleTime: 5 * 60 * 1000,
  });
}
export function useWaTopContacts(limit = 10, days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-top-contacts", limit, days],
    queryFn: () => waAnalyticsRepository.getTopContacts(limit, days),
    staleTime: 60 * 1000,
  });
}
export function useWaCampaignAnalytics(limit = 10) {
  return useQuery({
    queryKey: ["wa-analytics-campaigns", limit],
    queryFn: () => waAnalyticsRepository.getCampaigns(limit),
    staleTime: 60 * 1000,
  });
}
export function useWaAiUsage(days = 30) {
  return useQuery({
    queryKey: ["wa-analytics-ai", days],
    queryFn: () => waAnalyticsRepository.getAiUsage(days),
    staleTime: 60 * 1000,
  });
}
export function useWaHourlyActivity(days = 7) {
  return useQuery({
    queryKey: ["wa-analytics-hourly", days],
    queryFn: () => waAnalyticsRepository.getHourlyActivity(days),
    staleTime: 5 * 60 * 1000,
  });
}

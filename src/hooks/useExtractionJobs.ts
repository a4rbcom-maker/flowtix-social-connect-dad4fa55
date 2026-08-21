import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/authProvider";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { ExtractionJob, StartExtractionInput, ExtractionProgress, ExportResult, ExportFormat } from "@/lib/extraction/types";

const JOBS_KEY = "extraction-jobs";
const JOB_KEY = "extraction-job";

export function useExtractionJobs() {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  return useQuery({
    queryKey: [JOBS_KEY, userId],
    queryFn: () => {
      if (!userId) return [] as ExtractionJob[];
      return extractionRepository.listJobs(userId);
    },
    enabled: !!userId,
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs || jobs.length === 0) return false;
      const hasActive = jobs.some(j => j.status === "running" || j.status === "queued" || j.status === "paused");
      return hasActive ? 3000 : false;
    },
  });
}

export function useExtractionJob(jobId: string | undefined) {
  return useQuery({
    queryKey: [JOB_KEY, jobId],
    queryFn: () => extractionRepository.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 3000 : false;
    },
  });
}

export function useStartExtraction() {
  const queryClient = useQueryClient();
  return useMutation<ExtractionProgress, Error, StartExtractionInput>({
    mutationFn: (input) => extractionRepository.startExtraction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

export function useContinueExtraction() {
  const queryClient = useQueryClient();
  return useMutation<
    ExtractionProgress,
    Error,
    { jobId: string; cursor: string; maxResults: number; skipDuplicates: boolean; sessionId: string; dbType: string; sourceUrl: string }
  >({
    mutationFn: ({ jobId, cursor, maxResults, skipDuplicates, sessionId, dbType, sourceUrl }) =>
      extractionRepository.continueExtraction(jobId, cursor, maxResults, skipDuplicates, sessionId, dbType, sourceUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

export function useCancelExtraction() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (jobId) => extractionRepository.cancelJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

export function useForceStopJob() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (jobId) => extractionRepository.forceStopJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

export function useDeleteExtraction() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (jobId) => extractionRepository.deleteJob(jobId),
    onSuccess: (_data, jobId) => {
      queryClient.removeQueries({ queryKey: [JOB_KEY, jobId] });
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    },
  });
}

export function useExportResults() {
  return useMutation<ExportResult, Error, { jobId: string; format: ExportFormat }>({
    mutationFn: ({ jobId, format }) => extractionRepository.exportResults(jobId, format),
  });
}

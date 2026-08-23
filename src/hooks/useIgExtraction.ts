import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { ExtractionJob, StartExtractionInput, ExtractionProgress } from "@/lib/extraction/types";

const IG_JOBS_KEY = "extraction-jobs";

export interface IgExtractionInput extends StartExtractionInput {
  ceiling?: number;
}

export function useIgExtraction() {
  const queryClient = useQueryClient();

  const start = useMutation<ExtractionProgress, Error, StartExtractionInput>({
    mutationFn: (input) => extractionRepository.startExtraction(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [IG_JOBS_KEY] });
    },
  });

  const cancel = useMutation<void, Error, string>({
    mutationFn: (jobId) => extractionRepository.cancelJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [IG_JOBS_KEY] });
    },
  });

  return { start, cancel };
}

/** استطلاع مهمة IG مع اشتقاق نسبة تغطية المتابعين من progress.coverage_rate */
export function useIgJob(jobId: string | undefined) {
  return useQuery<ExtractionJob | undefined>({
    queryKey: ["extraction-job", jobId],
    queryFn: () => (jobId ? extractionRepository.getJob(jobId) : undefined),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll while running AND shortly after settling, so a dropped realtime
      // channel still delivers the final status transition to the UI.
      if (status === "running" || status === "queued") return 3000;
      return query.state.dataUpdatedAt && Date.now() - query.state.dataUpdatedAt < 15000 ? 3000 : false;
    },
  });
}

export function useIgCoverage(job: ExtractionJob | undefined): {
  extracted: number;
  total: number | null;
  coverage: number | null;
} {
  if (!job) return { extracted: 0, total: null, coverage: null };
  const progress = ((job as { progress?: Record<string, unknown> }).progress ?? {}) as Record<string, unknown>;
  const total = (progress.total as number) ?? null;
  const coverage = (progress.coverage_rate as number | null) ?? null;
  return {
    extracted: (progress.extracted as number) ?? job.result_count ?? 0,
    total,
    coverage,
  };
}
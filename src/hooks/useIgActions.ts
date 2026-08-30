import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { igActionRepository } from "@/lib/ig-actions/ig-action-repository";
import type { IgActionJobDetails } from "@/lib/ig-actions/types";

const JOB_KEY = "ig-action-job";

export function useIgActionJob(jobId: string | undefined) {
  return useQuery<IgActionJobDetails, Error>({
    queryKey: [JOB_KEY, jobId],
    queryFn: () => igActionRepository.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === "running" || status === "queued" ? 3000 : false;
    },
  });
}

export function useIgActionPreview(sourceJobId: string | undefined, mode: "mention" | "dm", body: string, mentionsPerComment?: number) {
  return useQuery<IgActionJobDetails extends never ? never : Awaited<ReturnType<typeof igActionRepository.preview>>, Error>({
    queryKey: ["ig-action-preview", sourceJobId, mode, body, mentionsPerComment],
    queryFn: () => igActionRepository.preview(sourceJobId!, mode, body, mentionsPerComment),
    enabled: !!sourceJobId && body.trim().length > 0,
    staleTime: 10_000,
  });
}

export function useIgActionActions(jobId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [JOB_KEY, jobId] });
  return {
    pause: useMutation({ mutationFn: () => igActionRepository.pause(jobId), onSettled: invalidate }),
    resume: useMutation({ mutationFn: () => igActionRepository.resume(jobId), onSettled: invalidate }),
    stop: useMutation({ mutationFn: () => igActionRepository.stop(jobId), onSettled: invalidate }),
  };
}

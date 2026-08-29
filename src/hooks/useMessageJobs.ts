import { useQuery, useMutation } from "@tanstack/react-query";
import { messageRepository } from "@/lib/messaging/message-repository";
import type { MessageJobDetails } from "@/lib/messaging/types";

const JOB_KEY = "message-job";

export function useMessageJob(jobId: string | undefined) {
  return useQuery<MessageJobDetails, Error>({
    queryKey: [JOB_KEY, jobId],
    queryFn: () => messageRepository.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === "running" || status === "queued" ? 3000 : false;
    },
  });
}

export function useMessageActions(jobId: string) {
  const invalidate = () => void jobId;
  return {
    pause: useMutation({ mutationFn: () => messageRepository.pause(jobId), onSettled: invalidate }),
    resume: useMutation({ mutationFn: () => messageRepository.resume(jobId), onSettled: invalidate }),
    stop: useMutation({ mutationFn: () => messageRepository.stop(jobId), onSettled: invalidate }),
  };
}

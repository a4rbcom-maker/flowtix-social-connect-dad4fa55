import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waAiModelsRepository } from "@/lib/wa-ai-models";

const KEY = "wa-ai-models";

export function useWaAiModels() {
  return useQuery({
    queryKey: [KEY],
    queryFn: () => waAiModelsRepository.listActive(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useWaAiModelsAdmin() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [KEY, "admin"],
    queryFn: () => waAiModelsRepository.listAll(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      waAiModelsRepository.toggleActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => waAiModelsRepository.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof waAiModelsRepository.save>[0]) =>
      waAiModelsRepository.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  return { query, toggle, remove, save };
}

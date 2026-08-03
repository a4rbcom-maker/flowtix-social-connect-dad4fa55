import { supabase } from "@/lib/supabase";
import {
  type ExtractionJob,
  type ExtractionResult,
  type StartExtractionInput,
  type ExtractionProgress,
  type ExportResult,
  type ExportFormat,
  SOURCE_TO_DB_TYPE,
} from "./types";

const EXTRACTION_API_URL = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
const EXTRACTION_API_KEY = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";

async function readFetchError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.error ?? body?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export const extractionRepository = {
  async listJobs(userId: string): Promise<ExtractionJob[]> {
    const { data, error } = await supabase
      .from("extraction_jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async getJob(jobId: string): Promise<ExtractionJob> {
    const { data, error } = await supabase
      .from("extraction_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (error) throw error;
    return data;
  },

  async getResults(jobId: string, page = 0, pageSize = 50): Promise<{ data: ExtractionResult[]; count: number }> {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const [resultQuery, countQuery] = await Promise.all([
      supabase.from("extraction_results").select("*").eq("job_id", jobId).range(from, to),
      supabase.from("extraction_results").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    ]);
    if (resultQuery.error) throw resultQuery.error;
    return { data: resultQuery.data, count: countQuery.count ?? 0 };
  },

  async cancelJob(jobId: string): Promise<void> {
    const { error } = await supabase
      .from("extraction_jobs")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw error;
  },

  async forceStopJob(jobId: string): Promise<void> {
    const { error } = await supabase
      .from("extraction_jobs")
      .update({ status: "failed", error: "Force stopped by user", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw error;
  },

  async startExtraction(input: StartExtractionInput): Promise<ExtractionProgress> {
    const dbType = SOURCE_TO_DB_TYPE[input.type];
    const sessionIds = input.session_ids && input.session_ids.length > 0
      ? Array.from(new Set([input.session_id, ...input.session_ids])).filter(Boolean)
      : [input.session_id];
    const res = await fetch(`${EXTRACTION_API_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": EXTRACTION_API_KEY },
      body: JSON.stringify({
        session_id: sessionIds[0],
        session_ids: sessionIds,
        type: dbType,
        source_url: input.source_url,
        job_name: input.job_name,
        max_results: input.max_results ?? 100000,
        skip_duplicates: input.skip_duplicates ?? true,
      }),
    });
    if (!res.ok) throw new Error(await readFetchError(res));
    return res.json();
  },

  async continueExtraction(jobId: string, cursor: string, maxResults: number, skipDuplicates: boolean, sessionId: string, dbType: string, sourceUrl: string): Promise<ExtractionProgress> {
    const res = await fetch(`${EXTRACTION_API_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": EXTRACTION_API_KEY },
      body: JSON.stringify({ job_id: jobId, cursor, max_results: maxResults, skip_duplicates: skipDuplicates, session_id: sessionId, type: dbType, source_url: sourceUrl }),
    });
    if (!res.ok) throw new Error(await readFetchError(res));
    return res.json();
  },

  async exportResults(jobId: string, format: ExportFormat): Promise<ExportResult> {
    const res = await fetch(`${EXTRACTION_API_URL}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": EXTRACTION_API_KEY },
      body: JSON.stringify({ job_id: jobId, format }),
    });
    if (!res.ok) throw new Error(await readFetchError(res));

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowtix-export-${jobId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    return { export_id: jobId, download_url: url, row_count: 0, file_size_bytes: blob.size, format };
  },

  subscribeToJob(jobId: string, callback: (job: ExtractionJob) => void) {
    return supabase
      .channel(`extraction-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "extraction_jobs", filter: `id=eq.${jobId}` },
        (payload) => callback(payload.new as ExtractionJob),
      )
      .subscribe();
  },

  unsubscribe(channel: ReturnType<typeof supabase.channel>) {
    supabase.removeChannel(channel);
  },
};

import type { IgActionJobDetails, IgActionPreview, StartIgActionInput } from "./types";

const EXTRACTION_API_URL = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
const EXTRACTION_API_KEY = import.meta.env.VITE_EXTRACTION_API_KEY || "";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${EXTRACTION_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": EXTRACTION_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readFetchError(res));
  return res.json();
}

async function readFetchError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export const igActionRepository = {
  async preview(sourceJobId: string, mode: "mention" | "dm", body: string, mentionsPerComment?: number): Promise<IgActionPreview> {
    return postJson<IgActionPreview>("/ig-actions/preview", {
      source_job_id: sourceJobId,
      mode,
      body,
      mentions_per_comment: mentionsPerComment,
    });
  },

  async start(input: StartIgActionInput): Promise<{ job_id: string; recipient_count: number }> {
    return postJson("/ig-actions/start", input);
  },

  async pause(jobId: string): Promise<void> {
    await postJson("/ig-actions/pause", { job_id: jobId });
  },

  async resume(jobId: string): Promise<void> {
    await postJson("/ig-actions/resume", { job_id: jobId });
  },

  async stop(jobId: string): Promise<void> {
    await postJson("/ig-actions/stop", { job_id: jobId });
  },

  async getJob(jobId: string): Promise<IgActionJobDetails> {
    const res = await fetch(`${EXTRACTION_API_URL}/ig-actions/${jobId}`, {
      headers: { "X-API-Key": EXTRACTION_API_KEY },
    });
    if (!res.ok) throw new Error(await readFetchError(res));
    return res.json();
  },
};

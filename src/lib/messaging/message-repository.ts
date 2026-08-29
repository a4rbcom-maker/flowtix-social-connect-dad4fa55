import type {
  MessageJobDetails,
  MessagePreview,
  StartMessageInput,
} from "./types";

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

export const messageRepository = {
  async preview(sourceJobId: string, body: string): Promise<MessagePreview> {
    return postJson<MessagePreview>("/messages/preview", { source_job_id: sourceJobId, body });
  },

  async start(input: StartMessageInput): Promise<{ job_id: string; recipient_count: number }> {
    return postJson("/messages/start", input);
  },

  async pause(jobId: string): Promise<void> {
    await postJson("/messages/pause", { job_id: jobId });
  },

  async resume(jobId: string): Promise<void> {
    await postJson("/messages/resume", { job_id: jobId });
  },

  async stop(jobId: string): Promise<void> {
    await postJson("/messages/stop", { job_id: jobId });
  },

  async getJob(jobId: string): Promise<MessageJobDetails> {
    const res = await fetch(`${EXTRACTION_API_URL}/messages/${jobId}`, {
      headers: { "X-API-Key": EXTRACTION_API_KEY },
    });
    if (!res.ok) throw new Error(await readFetchError(res));
    return res.json();
  },

  async uploadMedia(file: File): Promise<{ key: string; mimeType: string }> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${EXTRACTION_API_URL}/messages/media/upload`, {
      method: "POST",
      headers: { "X-API-Key": EXTRACTION_API_KEY },
      body: form,
    });
    if (!res.ok) throw new Error(await readFetchError(res));
    return res.json();
  },
};

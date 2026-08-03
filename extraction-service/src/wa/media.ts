import { supabaseClient } from "../services/supabase.js";
import { logger } from "../logger.js";

const BUCKET = "wa-media";
const log = logger;

export const mediaService = {
  async downloadAndStore(sessionId: string, waMessageId: string, streamSupplier: () => Promise<Buffer>, mime: string): Promise<string | null> {
    try {
      const buf = await streamSupplier();
      const ext = (mime.split("/")[1] || "bin").split("+")[0];
      const key = `${sessionId}/${waMessageId}.${ext}`;
      await supabaseClient.storage.from(BUCKET).upload(key, buf, { upsert: true, contentType: mime });
      return key;
    } catch (e) { log.error("WAMedia", `store failed: ${String(e)}`); return null; }
  },

  async signedUrl(key: string, expiresIn = 3600): Promise<string> {
    const { data } = await supabaseClient.storage.from(BUCKET).createSignedUrl(key, expiresIn);
    return data?.signedUrl ?? "";
  },
};

import { Router } from "express";
import { z } from "zod";
import { loadProviderConfig } from "./config.js";
import { kieChat } from "./kie-client.js";
import { ExtractionError, ErrorCodes } from "../errors.js";

const router = Router();

router.post("/ai/test", async (req, res) => {
  const parsed = z.object({ workspace_id: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: "workspace_id required" } });
  const cfg = await loadProviderConfig(parsed.data.workspace_id);
  if (!cfg) return res.status(400).json({ message: "no active kie config — set api_key + models first" });
  const r = await kieChat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.l1, messages: [{ role: "user", content: "ping" }], maxTokens: 5, timeoutMs: 10000 });
  res.json({ success: r.success, message: r.success ? `OK: ${r.content.slice(0, 50)}` : r.error });
});

export default router;

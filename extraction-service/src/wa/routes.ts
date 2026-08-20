import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { waManager } from "./wa-manager.js";
import { mediaService } from "./media.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";

const log = logger;
const router = Router();

router.post("/wa/start", async (req, res) => {
  const schema = z.object({ session_id: z.string().min(1), workspace_id: z.string().uuid().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map(i => i.message).join(", ") } });
  try {
    await waManager.requestQR(parsed.data.session_id, parsed.data.workspace_id);
    res.json({ session_id: parsed.data.session_id, status: "starting" });
  } catch (e) { log.error("WARoute", `start: ${String(e)}`); res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: String(e) } }); }
});

router.get("/wa/:sessionId/qr", async (req, res) => {
  const qr = waManager.getQR(req.params.sessionId);
  if (!qr) return res.status(404).json({ error: { code: "QR_NOT_READY", message: "QR not generated yet" } });
  res.json({ session_id: req.params.sessionId, qr });
});

router.get("/wa/:sessionId/status", async (req, res) => {
  const { data } = await import("../services/supabase.js").then(m => m.supabaseClient.from("wa_sessions").select("status, push_name, phone_number").eq("id", req.params.sessionId).is("deleted_at", null).single());
  res.json({ session_id: req.params.sessionId, status: data?.status ?? "disconnected", push_name: data?.push_name, phone: data?.phone_number });
});

const sendSchema = z.object({ session_id: z.string().min(1), to: z.string().min(1), payload: z.object({ type: z.string(), text: z.string().optional(), mediaUrl: z.string().optional(), caption: z.string().optional(), mimeType: z.string().optional(), fileName: z.string().optional() }) });
router.post("/wa/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map(i => i.message).join(", ") } });
  try {
    const result = await waManager.send(parsed.data.session_id, parsed.data.to, parsed.data.payload);
    res.json(result);
  } catch (e) { log.error("WARoute", `send: ${String(e)}`); res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: String(e) } }); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.post("/wa/media/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: "No file provided" } });
    const sessionId = req.body.session_id || "upload";
    const ext = file.originalname.split(".").pop() || "bin";
    const key = `${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { supabaseClient } = await import("../services/supabase.js");
    await supabaseClient.storage.from("wa-media").upload(key, file.buffer, { upsert: true, contentType: file.mimetype });
    const signedUrl = await mediaService.signedUrl(key);
    res.json({ key, url: signedUrl, mimeType: file.mimetype, fileName: file.originalname, size: file.size });
  } catch (e) { log.error("WARoute", `media upload: ${String(e)}`); res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: String(e) } }); }
});

// Campaign control routes
import { startCampaignWorker, stopCampaignWorker } from "./campaign-worker.js";
import { supabaseClient } from "../services/supabase.js";

router.post("/wa/campaigns/:id/start", async (req, res) => {
  try {
    await supabaseClient.from("wa_campaigns").update({ status: "running" } as never).eq("id", req.params.id);
    startCampaignWorker(req.params.id);
    res.json({ status: "started" });
  } catch (e: any) {
    log.error("WARoute", `campaign start: ${String(e)}`);
    res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: "Internal server error" } });
  }
});
router.post("/wa/campaigns/:id/pause", async (req, res) => {
  try {
    stopCampaignWorker(req.params.id);
    await supabaseClient.from("wa_campaigns").update({ status: "paused" } as never).eq("id", req.params.id);
    res.json({ status: "paused" });
  } catch (e: any) {
    log.error("WARoute", `campaign pause: ${String(e)}`);
    res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: "Internal server error" } });
  }
});
router.post("/wa/campaigns/:id/resume", async (req, res) => {
  try {
    await supabaseClient.from("wa_campaigns").update({ status: "running" } as never).eq("id", req.params.id);
    startCampaignWorker(req.params.id);
    res.json({ status: "resumed" });
  } catch (e: any) {
    log.error("WARoute", `campaign resume: ${String(e)}`);
    res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: "Internal server error" } });
  }
});
router.post("/wa/campaigns/:id/stop", async (req, res) => {
  try {
    stopCampaignWorker(req.params.id);
    await supabaseClient.from("wa_campaigns").update({ status: "canceled" } as never).eq("id", req.params.id);
    res.json({ status: "stopped" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;

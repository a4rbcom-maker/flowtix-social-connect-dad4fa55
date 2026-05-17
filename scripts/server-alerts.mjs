import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_THROTTLE_MS = 15 * 60 * 1000;
const DEFAULT_STATE_FILE = "var/server-alert-state.json";
const DEFAULT_LOG_FILE = "var/server-alerts.jsonl";

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value, max = 800) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function errorToPayload(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: normalizeText(error.stack, 1800),
    };
  }
  return {
    name: typeof error,
    message: normalizeText(error, 800),
    stack: "",
  };
}

function firstConfiguredEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function stableFingerprint(parts) {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function createAlertManager(options = {}) {
  const appName = options.appName || process.env.APP_NAME || "flowtixtools-web";
  const root = options.root || process.cwd();
  const webhookUrl = firstConfiguredEnv([
    "FLOWTIX_ALERT_WEBHOOK_URL",
    "ALERT_WEBHOOK_URL",
    "SSR_ALERT_WEBHOOK_URL",
  ]);
  const throttleMs = safeNumber(process.env.ALERT_THROTTLE_MS, DEFAULT_THROTTLE_MS);
  const stateFile = resolve(root, process.env.ALERT_STATE_FILE || DEFAULT_STATE_FILE);
  const logFile = resolve(root, process.env.ALERT_LOG_FILE || DEFAULT_LOG_FILE);
  const deployment = {
    sha: process.env.DEPLOY_SHA || process.env.GITHUB_SHA || "unknown",
    runId: process.env.DEPLOY_RUN_ID || process.env.GITHUB_RUN_ID || null,
    repo: process.env.DEPLOY_REPOSITORY || process.env.GITHUB_REPOSITORY || null,
    deployedAt: process.env.DEPLOYED_AT || null,
  };

  let state = { fingerprints: {} };
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    state = { fingerprints: {} };
  }

  function persistState() {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  function appendAlertLog(alert) {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${JSON.stringify(alert)}\n`);
  }

  async function postWebhook(alert) {
    if (!webhookUrl) return { delivered: false, reason: "webhook_not_configured" };

    const text = [
      `🚨 ${appName} ${alert.kind} error`,
      `${alert.method || ""} ${alert.path || ""} ${alert.status ? `→ ${alert.status}` : ""}`.trim(),
      alert.error?.message || alert.bodySnippet || "Server error detected",
      deployment.sha && deployment.sha !== "unknown" ? `commit: ${deployment.sha.slice(0, 7)}` : null,
    ].filter(Boolean).join("\n");

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, app: appName, alert }),
    });

    if (!response.ok) {
      return { delivered: false, reason: `webhook_${response.status}` };
    }
    return { delivered: true };
  }

  async function notify(input) {
    const now = Date.now();
    const alert = {
      app: appName,
      at: new Date(now).toISOString(),
      deployment,
      kind: input.kind || "server",
      method: input.method || null,
      path: input.path || null,
      status: input.status || null,
      bodySnippet: normalizeText(input.bodySnippet, 700),
      error: input.error ? errorToPayload(input.error) : null,
    };

    alert.fingerprint = stableFingerprint([
      alert.kind,
      alert.method,
      alert.path,
      String(alert.status || ""),
      alert.error?.name,
      alert.error?.message || alert.bodySnippet,
    ]);

    const previousAt = state.fingerprints?.[alert.fingerprint] || 0;
    const suppressed = now - previousAt < throttleMs;
    const logRecord = { ...alert, suppressed };
    appendAlertLog(logRecord);

    if (suppressed) {
      console.warn(`[server-alert suppressed] ${alert.kind} ${alert.method || ""} ${alert.path || ""} ${alert.error?.message || alert.bodySnippet}`);
      return { delivered: false, suppressed: true };
    }

    state.fingerprints = state.fingerprints || {};
    state.fingerprints[alert.fingerprint] = now;
    persistState();

    console.error("[server-alert]", JSON.stringify(alert));

    try {
      return await postWebhook(alert);
    } catch (webhookError) {
      console.error("[server-alert webhook failed]", webhookError);
      return { delivered: false, reason: "webhook_failed" };
    }
  }

  return { notify };
}

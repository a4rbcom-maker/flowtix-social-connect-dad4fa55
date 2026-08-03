import dotenv from "dotenv";
dotenv.config();

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

export const config = {
  port: envInt("PORT", 3100),
  apiKey: (() => {
    const key = process.env.API_KEY;
    if (!key || key === "local-dev-key-change-in-production") {
      throw new Error("API_KEY environment variable is required - do not use the default key in any environment");
    }
    return key;
  })(),
  nodeEnv: env("NODE_ENV", "development"),
  isDev: env("NODE_ENV", "development") === "development",

  allowedOrigins: env("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),

  supabaseUrl: env("SUPABASE_URL", ""),
  supabaseServiceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY", ""),

  browserPoolSize: envInt("BROWSER_POOL_SIZE", 2),
  maxContextsPerBrowser: envInt("MAX_CONTEXTS_PER_BROWSER", 3),
  headless: envBool("HEADLESS", true),

  maxConcurrentJobs: envInt("MAX_CONCURRENT_JOBS", 2),
  jobTimeoutMs: envInt("JOB_TIMEOUT_MS", 120000),

  maxRetries: envInt("MAX_RETRIES", 3),
  retryDelayMs: envInt("RETRY_DELAY_MS", 2000),

  fbBaseUrl: env("FB_BASE_URL", "https://mbasic.facebook.com"),
  fbNavTimeoutMs: envInt("FB_NAV_TIMEOUT_MS", 30000),

  logLevel: env("LOG_LEVEL", "info"),

  enrichmentDbPath: env("ENRICHMENT_DB_PATH", "../Egypt DB/egypt db"),
  enrichmentEnabled: envBool("ENRICHMENT_ENABLED", true),
  enrichmentBatchSize: envInt("ENRICHMENT_BATCH_SIZE", 500),

  userAgent:
    "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",

  /** Global proxy URL (applies to all sessions if no per-session proxy) */
  proxyUrl: env("PROXY_URL", ""),
} as const;

export type Config = typeof config;

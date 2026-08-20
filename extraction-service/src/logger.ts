import { config } from "./config.js";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type LogLevel = "debug" | "info" | "warn" | "error" | "trace";

const LEVELS: Record<LogLevel, number> = {
  trace: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[config.logLevel as LogLevel] ?? LEVELS.info;

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, "..", "extraction.log");

function ts(): string {
  return new Date().toISOString();
}

function format(level: LogLevel, module: string, msg: string, extra?: unknown): string {
  const base = `[${ts()}] [${level.toUpperCase()}] [${module}] ${msg}`;
  if (extra !== undefined) {
    try {
      return `${base} ${JSON.stringify(extra)}`;
    } catch {
      return `${base} [unserializable]`;
    }
  }
  return base;
}

function emit(level: LogLevel, module: string, msg: string, extra?: unknown): void {
  const line = format(level, module, msg, extra);
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : level === "info" ? console.info : level === "trace" ? console.trace : console.debug;
  fn(line);
  try { appendFileSync(LOG_FILE, line + "\n", "utf-8"); } catch {}
}

export const logger = {
  level: currentLevel,
  trace(module: string, msg: string, extra?: unknown): void {
    if (currentLevel <= LEVELS.trace) emit("trace", module, msg, extra);
  },
  debug(module: string, msg: string, extra?: unknown): void {
    if (currentLevel <= LEVELS.debug) emit("debug", module, msg, extra);
  },
  info(module: string, msg: string, extra?: unknown): void {
    if (currentLevel <= LEVELS.info) emit("info", module, msg, extra);
  },
  warn(module: string, msg: string, extra?: unknown): void {
    if (currentLevel <= LEVELS.warn) emit("warn", module, msg, extra);
  },
  error(module: string, msg: string, extra?: unknown): void {
    if (currentLevel <= LEVELS.error) emit("error", module, msg, extra);
  },
};

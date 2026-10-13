import "server-only";

/**
 * Minimal structured logger (JSON lines in production, readable in dev).
 * Swap for pino/Sentry transport in Phase 10 without touching call sites.
 */
type Level = "debug" | "info" | "warn" | "error";

function serialize(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v;
  }
  return out;
}

function log(level: Level, obj: Record<string, unknown>, msg: string) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = { level, time: new Date().toISOString(), msg, ...serialize(obj) };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(process.env.NODE_ENV === "production" ? JSON.stringify(line) : line);
}

export const logger = {
  debug: (obj: Record<string, unknown>, msg: string) => log("debug", obj, msg),
  info: (obj: Record<string, unknown>, msg: string) => log("info", obj, msg),
  warn: (obj: Record<string, unknown>, msg: string) => log("warn", obj, msg),
  error: (obj: Record<string, unknown>, msg: string) => log("error", obj, msg),
};

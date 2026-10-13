/** Accept only same-site relative paths for post-login redirects (blocks open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = "/staff"): string {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/api/") || value.startsWith("/staff/login")) return fallback;
  return value;
}

/** Display formatting. All dates are shown in the business time zone. */
export const BUSINESS_TZ = "Asia/Karachi";

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, day: "2-digit", month: "short", year: "numeric" });

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(typeof value === "string" ? new Date(value) : value);
}

/** "3 min ago", "2 h ago", "5 days ago". */
export function timeAgo(value: Date | string | null | undefined, now = Date.now()): string {
  if (!value) return "Never";
  const ms = now - (typeof value === "string" ? new Date(value) : value).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

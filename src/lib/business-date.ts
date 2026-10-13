/**
 * Business day: sales before the cut-off hour (e.g. 05:00) belong to the
 * previous calendar day, so a shift running 18:00–03:00 is one business day.
 */
export function businessDate(now: Date, timeZone: string, cutoffHour: number): string {
  const shifted = new Date(now.getTime() - cutoffHour * 3_600_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    shifted,
  );
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "2026-10-12" → "261012" (used in order numbers). */
export function compactDate(isoDate: string): string {
  return isoDate.slice(2, 4) + isoDate.slice(5, 7) + isoDate.slice(8, 10);
}

/** UTC instant range covering a business day [start, end). */
export function businessDayRange(isoDate: string, timeZoneOffsetMinutes: number, cutoffHour: number): { start: Date; end: Date } {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const startUtc = Date.UTC(y, m - 1, d, cutoffHour, 0, 0) - timeZoneOffsetMinutes * 60_000;
  return { start: new Date(startUtc), end: new Date(startUtc + 86_400_000) };
}

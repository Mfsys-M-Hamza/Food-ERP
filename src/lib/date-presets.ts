/** Date range presets for report filters, relative to the business "today" (ISO dates). */

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function datePresets(today: string): { label: string; from: string; to: string }[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const monday = shift(today, -((dow + 6) % 7));
  const firstThis = `${today.slice(0, 7)}-01`;
  const firstLast = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const lastLast = shift(firstThis, -1);
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: shift(today, -1), to: shift(today, -1) },
    { label: "This week", from: monday, to: today },
    { label: "Last 7 days", from: shift(today, -6), to: today },
    { label: "This month", from: firstThis, to: today },
    { label: "Last month", from: firstLast, to: lastLast },
    { label: "Last 30 days", from: shift(today, -29), to: today },
    { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

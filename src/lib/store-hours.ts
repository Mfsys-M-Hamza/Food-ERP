/**
 * Opening-hours logic (pure). Handles closing after midnight: 11:00–01:00 on
 * Friday means open until 01:00 on Saturday morning.
 */
export type HoursRow = { weekday: number; isClosed: boolean; opensAt: string; closesAt: string };
export type HoursException = { date: string; isClosed: boolean; opensAt: string | null; closesAt: string | null };

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday, minutes: hour * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

function previousDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayWindow(hours: HoursRow[], exceptions: HoursException[], date: string, weekday: number) {
  const ex = exceptions.find((e) => e.date === date);
  if (ex) return ex.isClosed || !ex.opensAt || !ex.closesAt ? null : { opens: toMin(ex.opensAt), closes: toMin(ex.closesAt) };
  const row = hours.find((h) => h.weekday === weekday);
  if (!row || row.isClosed) return null;
  return { opens: toMin(row.opensAt), closes: toMin(row.closesAt) };
}

export function isOpenAt(now: Date, timeZone: string, hours: HoursRow[], exceptions: HoursException[] = []): boolean {
  const { date, weekday, minutes } = localParts(now, timeZone);
  const today = dayWindow(hours, exceptions, date, weekday);
  if (today) {
    const overnight = today.closes <= today.opens;
    if (overnight ? minutes >= today.opens : minutes >= today.opens && minutes < today.closes) return true;
  }
  // Still inside yesterday's overnight window?
  const yesterday = dayWindow(hours, exceptions, previousDate(date), (weekday + 6) % 7);
  if (yesterday && yesterday.closes <= yesterday.opens && minutes < yesterday.closes) return true;
  return false;
}

/** "Opens today at 11:00" / "Opens Monday at 11:00" for closed shops. */
export function nextOpening(now: Date, timeZone: string, hours: HoursRow[]): string | null {
  const { weekday, minutes } = localParts(now, timeZone);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < 8; i++) {
    const wd = (weekday + i) % 7;
    const row = hours.find((h) => h.weekday === wd);
    if (!row || row.isClosed) continue;
    if (i === 0 && toMin(row.opensAt) <= minutes) continue;
    return `Opens ${i === 0 ? "today" : i === 1 ? "tomorrow" : names[wd]} at ${row.opensAt}`;
  }
  return null;
}

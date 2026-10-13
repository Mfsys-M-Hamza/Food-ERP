import { describe, expect, it } from "vitest";
import { isOpenAt, nextOpening, type HoursRow } from "@/lib/store-hours";

const TZ = "Asia/Karachi"; // UTC+5
const at = (iso: string) => new Date(iso);
const everyDay = (opensAt: string, closesAt: string, closed: number[] = []): HoursRow[] =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, isClosed: closed.includes(weekday), opensAt, closesAt }));

describe("opening hours", () => {
  it("handles same-day hours", () => {
    const h = everyDay("11:00", "23:00");
    expect(isOpenAt(at("2026-10-12T06:00:00Z"), TZ, h)).toBe(true); // 11:00 local
    expect(isOpenAt(at("2026-10-12T05:59:00Z"), TZ, h)).toBe(false); // 10:59
    expect(isOpenAt(at("2026-10-12T18:00:00Z"), TZ, h)).toBe(false); // 23:00
  });

  it("handles closing after midnight", () => {
    const h = everyDay("11:00", "01:00");
    expect(isOpenAt(at("2026-10-12T19:30:00Z"), TZ, h)).toBe(true); // 00:30 next day
    expect(isOpenAt(at("2026-10-12T20:30:00Z"), TZ, h)).toBe(false); // 01:30
  });

  it("respects a closed day, including yesterday's overnight window", () => {
    // Monday (1) closed; Sunday 11:00–01:00 still runs into Monday 00:30.
    const h = everyDay("11:00", "01:00", [1]);
    expect(isOpenAt(at("2026-10-11T19:30:00Z"), TZ, h)).toBe(true); // Mon 00:30 (Sunday's window)
    expect(isOpenAt(at("2026-10-12T08:00:00Z"), TZ, h)).toBe(false); // Mon 13:00
  });

  it("treats equal open and close as open all day", () => {
    expect(isOpenAt(at("2026-10-12T22:00:00Z"), TZ, everyDay("00:00", "00:00"))).toBe(true);
  });

  it("applies holiday exceptions", () => {
    const h = everyDay("11:00", "23:00");
    const ex = [{ date: "2026-10-12", isClosed: true, opensAt: null, closesAt: null }];
    expect(isOpenAt(at("2026-10-12T08:00:00Z"), TZ, h, ex)).toBe(false);
  });

  it("describes the next opening", () => {
    const h = everyDay("11:00", "23:00");
    expect(nextOpening(at("2026-10-12T03:00:00Z"), TZ, h)).toBe("Opens today at 11:00");
    expect(nextOpening(at("2026-10-12T18:30:00Z"), TZ, h)).toBe("Opens tomorrow at 11:00");
  });
});

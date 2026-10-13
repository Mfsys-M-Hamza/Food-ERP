import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";
import { visibleNav } from "@/lib/nav";
import { timeAgo } from "@/lib/format";

describe("safeNextPath", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/admin/settings")).toBe("/admin/settings");
  });

  it("blocks open redirects and loops", () => {
    const bad = ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/staff/login", "/api/auth/x", "", null];
    for (const value of bad) expect(safeNextPath(value)).toBe("/staff");
  });
});

describe("visibleNav", () => {
  it("hides items the user cannot use", () => {
    const items = visibleNav(["pos.use"], false).flatMap((g) => g.items.map((i) => i.href));
    expect(items).toEqual(["/pos"]);
  });

  it("shows everything to the owner", () => {
    const items = visibleNav([], true).flatMap((g) => g.items.map((i) => i.href));
    expect(items).toEqual(expect.arrayContaining(["/admin", "/admin/settings", "/admin/users", "/admin/roles", "/admin/audit"]));
  });
});

describe("timeAgo", () => {
  it("formats relative times", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(timeAgo(null)).toBe("Never");
    expect(timeAgo(new Date(now - 30_000), now)).toBe("Just now");
    expect(timeAgo(new Date(now - 5 * 60_000), now)).toBe("5 min ago");
    expect(timeAgo(new Date(now - 3 * 3_600_000), now)).toBe("3 h ago");
    expect(timeAgo(new Date(now - 26 * 3_600_000), now)).toBe("1 day ago");
  });
});

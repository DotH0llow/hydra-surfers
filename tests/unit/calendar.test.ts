import { describe, expect, it } from "vitest";
import { DAY_OFFSET_MINUTES, dayIndex, dayIndexOf, dayKey, dayStart, daysBetween, nextDayStart, nextWeekStart, seedFor, weekIndex, weekKey, weekStart } from "../../src/shared/calendar";

/** 2026-09-15 is a Tuesday; the local offset is UTC-3 (Brazil). */
const TUE_LOCAL_NOON = Date.UTC(2026, 8, 15, 15); // 12:00 local

describe("shared/calendar", () => {
  it("rolls the day at local midnight, not at 00:00 UTC", () => {
    // 02:59 UTC is still the previous evening in Brazil
    expect(dayKey(Date.UTC(2026, 8, 15, 2, 59))).toBe("2026-09-14");
    expect(dayKey(Date.UTC(2026, 8, 15, 3, 0))).toBe("2026-09-15");
    expect(dayKey(TUE_LOCAL_NOON)).toBe("2026-09-15");
    expect(DAY_OFFSET_MINUTES).toBe(-180);
  });

  it("dayStart/nextDayStart bracket the local day", () => {
    const idx = dayIndex(TUE_LOCAL_NOON);
    const start = dayStart(idx);
    expect(dayKey(start)).toBe("2026-09-15");
    expect(start).toBeLessThanOrEqual(TUE_LOCAL_NOON);
    expect(nextDayStart(TUE_LOCAL_NOON)).toBe(start + 86_400_000);
    // the instant before the next reset is still the same day
    expect(dayKey(nextDayStart(TUE_LOCAL_NOON) - 1)).toBe("2026-09-15");
    expect(dayKey(nextDayStart(TUE_LOCAL_NOON))).toBe("2026-09-16");
  });

  it("weeks start on Monday and carry an ISO-style label", () => {
    expect(weekKey(TUE_LOCAL_NOON)).toBe("2026-W38");
    // Monday of that week and the Sunday that ends it share the key
    const monday = weekStart(weekIndex(TUE_LOCAL_NOON));
    expect(dayKey(monday)).toBe("2026-09-14");
    expect(weekKey(monday)).toBe("2026-W38");
    expect(weekKey(nextWeekStart(TUE_LOCAL_NOON) - 1)).toBe("2026-W38");
    expect(weekKey(nextWeekStart(TUE_LOCAL_NOON))).toBe("2026-W39");
    // Sunday belongs to the week that started the previous Monday
    expect(weekIndex(Date.UTC(2026, 8, 20, 15))).toBe(weekIndex(TUE_LOCAL_NOON));
    // Monday starts a new one
    expect(weekIndex(Date.UTC(2026, 8, 21, 15))).toBe(weekIndex(TUE_LOCAL_NOON) + 1);
  });

  it("counts whole local days between timestamps", () => {
    expect(daysBetween(TUE_LOCAL_NOON, TUE_LOCAL_NOON)).toBe(0);
    expect(daysBetween(TUE_LOCAL_NOON, TUE_LOCAL_NOON + 86_400_000)).toBe(1);
    // a late-night run and an early-morning one are the same local day
    expect(daysBetween(Date.UTC(2026, 8, 15, 23), Date.UTC(2026, 8, 16, 2))).toBe(0);
  });

  it("parses a content date key back to a day index", () => {
    expect(dayIndexOf("2026-09-15")).toBe(dayIndex(TUE_LOCAL_NOON));
    expect(dayKey(dayStart(dayIndexOf("2026-01-01")))).toBe("2026-01-01");
    expect(dayIndexOf("nonsense")).toBe(0);
  });

  it("gives every player the same seed for a period, and different seeds across periods", () => {
    expect(seedFor("daily", "2026-09-15")).toBe(seedFor("daily", "2026-09-15"));
    expect(seedFor("daily", "2026-09-15")).not.toBe(seedFor("daily", "2026-09-16"));
    // the same period in different modes must not replay the same track
    expect(seedFor("daily", "2026-W38")).not.toBe(seedFor("weekly", "2026-W38"));
    expect(seedFor("daily", "2026-09-15")).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(seedFor("daily", "2026-09-15"))).toBe(true);
  });
});

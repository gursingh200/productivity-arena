import { describe, it, expect } from "vitest";
import { toUserDay, getWeekRange } from "@/lib/timezone";

describe("toUserDay", () => {
  it("formats a UTC timestamp as YYYY-MM-DD in UTC", () => {
    const d = new Date("2024-03-15T12:00:00Z");
    expect(toUserDay(d, "UTC")).toBe("2024-03-15");
  });

  it("returns the previous calendar day for a timezone behind UTC", () => {
    // 2024-01-15 01:00 UTC is still 2024-01-14 in America/New_York (UTC-5)
    const d = new Date("2024-01-15T01:00:00Z");
    expect(toUserDay(d, "America/New_York")).toBe("2024-01-14");
  });

  it("returns the next calendar day for a timezone ahead of UTC", () => {
    // 2024-01-15 23:00 UTC is 2024-01-16 in Asia/Tokyo (UTC+9)
    const d = new Date("2024-01-15T23:00:00Z");
    expect(toUserDay(d, "Asia/Tokyo")).toBe("2024-01-16");
  });

  it("handles exact midnight UTC correctly", () => {
    const d = new Date("2024-06-01T00:00:00Z");
    expect(toUserDay(d, "UTC")).toBe("2024-06-01");
  });

  it("handles DST transition (America/New_York, summer → UTC-4)", () => {
    // 2024-06-15 04:30 UTC → 2024-06-15 00:30 EDT (UTC-4) → same day
    const d = new Date("2024-06-15T04:30:00Z");
    expect(toUserDay(d, "America/New_York")).toBe("2024-06-15");
  });

  it("returns YYYY-MM-DD format (hyphen-separated, zero-padded)", () => {
    const d = new Date("2024-01-05T12:00:00Z");
    const result = toUserDay(d, "UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getWeekRange", () => {
  it("returns Monday 00:00 → next Monday 00:00 for a UTC date", () => {
    // 2024-03-13 is a Wednesday
    const d = new Date("2024-03-13T12:00:00Z");
    const { start, end } = getWeekRange(d, "UTC");

    // Monday of that week: 2024-03-11
    expect(toUserDay(start, "UTC")).toBe("2024-03-11");
    // Next Monday: 2024-03-18
    expect(toUserDay(end, "UTC")).toBe("2024-03-18");
  });

  it("start is midnight in the given timezone", () => {
    const d = new Date("2024-03-13T12:00:00Z");
    const { start } = getWeekRange(d, "UTC");
    // Midnight UTC on Monday 2024-03-11
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
  });

  it("end - start = exactly 7 days", () => {
    const d = new Date("2024-03-13T12:00:00Z");
    const { start, end } = getWeekRange(d, "UTC");
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns the same week range for any day within the week", () => {
    const monday = new Date("2024-03-11T06:00:00Z");
    const friday = new Date("2024-03-15T12:00:00Z");
    const sunday = new Date("2024-03-17T22:00:00Z");

    const rangeFromMonday = getWeekRange(monday, "UTC");
    const rangeFromFriday = getWeekRange(friday, "UTC");
    const rangeFromSunday = getWeekRange(sunday, "UTC");

    expect(rangeFromMonday.start.getTime()).toBe(rangeFromFriday.start.getTime());
    expect(rangeFromMonday.start.getTime()).toBe(rangeFromSunday.start.getTime());
  });

  it("handles a timezone ahead of UTC (Asia/Kolkata UTC+5:30)", () => {
    // 2024-01-15 is a Monday; choose a date that's Tuesday in Kolkata
    // 2024-01-15 20:00 UTC = 2024-01-16 01:30 IST → Tuesday
    const d = new Date("2024-01-15T20:00:00Z");
    const { start } = getWeekRange(d, "Asia/Kolkata");
    // The Monday in IST for week containing IST-Tuesday 2024-01-16 is 2024-01-15
    expect(toUserDay(start, "Asia/Kolkata")).toBe("2024-01-15");
  });

  it("handles a timezone behind UTC (America/Los_Angeles, PST = UTC-8 in January)", () => {
    // 2024-01-10 is a Wednesday. In LA (PST, UTC-8), noon UTC = noon PST on Jan 10.
    const d = new Date("2024-01-10T20:00:00Z"); // noon PST on Jan 10 (Wednesday)
    const { start, end } = getWeekRange(d, "America/Los_Angeles");
    // Week should start on Monday 2024-01-08 (LA)
    expect(toUserDay(start, "America/Los_Angeles")).toBe("2024-01-08");
    expect(toUserDay(end, "America/Los_Angeles")).toBe("2024-01-15");
  });

  it("returns Mon→Mon boundary when date is exactly on Monday", () => {
    // Monday 2024-04-01 noon UTC
    const d = new Date("2024-04-01T12:00:00Z");
    const { start } = getWeekRange(d, "UTC");
    expect(toUserDay(start, "UTC")).toBe("2024-04-01");
  });

  it("returns prev-week Mon→Mon boundary when date is Sunday", () => {
    // Sunday 2024-03-17 noon UTC
    const d = new Date("2024-03-17T12:00:00Z");
    const { start, end } = getWeekRange(d, "UTC");
    expect(toUserDay(start, "UTC")).toBe("2024-03-11");
    expect(toUserDay(end, "UTC")).toBe("2024-03-18");
  });
});

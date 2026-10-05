import { afterEach, describe, expect, it, vi } from "vitest";
import { startDay, startInstant } from "@/lib/start-date";

afterEach(() => vi.unstubAllEnvs());

describe("ARENA_START_DATE", () => {
  it("is optional", () => {
    expect(startDay({})).toBeNull();
    expect(startInstant({})).toBeNull();
  });

  it("starts at midnight in the company timezone", () => {
    vi.stubEnv("ARENA_TIMEZONE", "Asia/Kolkata");
    expect(startInstant({ ARENA_START_DATE: "2026-10-05" })?.toISOString()).toBe("2026-10-04T18:30:00.000Z");
  });

  it("rejects anything but YYYY-MM-DD", () => {
    expect(() => startDay({ ARENA_START_DATE: "5 Oct" })).toThrow();
  });
});

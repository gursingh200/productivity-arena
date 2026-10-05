import { describe, it, expect } from "vitest";
import { computeLevel, levelThreshold, xpForLevel } from "@/lib/levels";

describe("xpForLevel", () => {
  it("level 1→2 requires 120 XP", () => {
    expect(xpForLevel(1)).toBe(120);
  });

  it("level 2→3 requires 140 XP", () => {
    expect(xpForLevel(2)).toBe(140);
  });

  it("level 3→4 requires 160 XP", () => {
    expect(xpForLevel(3)).toBe(160);
  });
});

describe("levelThreshold", () => {
  it("level 1 threshold is 0", () => {
    expect(levelThreshold(1)).toBe(0);
  });

  it("level 2 threshold is 120", () => {
    expect(levelThreshold(2)).toBe(120);
  });

  it("level 3 threshold is 260", () => {
    expect(levelThreshold(3)).toBe(260);
  });

  it("level 4 threshold is 420", () => {
    expect(levelThreshold(4)).toBe(420);
  });
});

describe("computeLevel", () => {
  it("0 XP → level 1, xpInLevel=0, xpForNext=120", () => {
    const r = computeLevel(0);
    expect(r.level).toBe(1);
    expect(r.xpInLevel).toBe(0);
    expect(r.xpForNext).toBe(120);
  });

  it("119 XP → level 1 (still below threshold for level 2)", () => {
    const r = computeLevel(119);
    expect(r.level).toBe(1);
    expect(r.xpInLevel).toBe(119);
  });

  it("120 XP → level 2, xpInLevel=0, xpForNext=140", () => {
    const r = computeLevel(120);
    expect(r.level).toBe(2);
    expect(r.xpInLevel).toBe(0);
    expect(r.xpForNext).toBe(140);
  });

  it("259 XP → level 2 (just below threshold for level 3)", () => {
    const r = computeLevel(259);
    expect(r.level).toBe(2);
    expect(r.xpInLevel).toBe(139);
  });

  it("260 XP → level 3", () => {
    const r = computeLevel(260);
    expect(r.level).toBe(3);
    expect(r.xpInLevel).toBe(0);
    expect(r.xpForNext).toBe(160);
  });

  it("handles large XP values and returns correct level", () => {
    // threshold(10) = 9 × (100 + 100) = 9 × 110 = 990... wait let me compute properly
    // threshold(n) via the iterative sum
    let xp = 0;
    for (let i = 1; i <= 9; i++) xp += 100 + 20 * i; // thresholds up to level 10
    // xp now = threshold(10)
    const r = computeLevel(xp);
    expect(r.level).toBe(10);
    expect(r.xpInLevel).toBe(0);
  });

  it("level is monotonically increasing with XP", () => {
    let prevLevel = 0;
    for (let xp = 0; xp <= 3000; xp += 10) {
      const { level } = computeLevel(xp);
      expect(level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = level;
    }
  });

  it("xpInLevel is always < xpForNext", () => {
    for (let xp = 0; xp <= 3000; xp += 7) {
      const r = computeLevel(xp);
      expect(r.xpInLevel).toBeLessThan(r.xpForNext);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  computeFocusXp,
  computeAgentXp,
  computeOrchestrationXp,
  computeLinearXp,
  type MinuteRow,
  type LinearIssue,
} from "@/lib/xp-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a MinuteRow at a given minute offset (t=0 is epoch minute 0). */
function row(
  minuteOffset: number,
  opts: Partial<Omit<MinuteRow, "t">> = {},
): MinuteRow {
  return {
    t: new Date(minuteOffset * 60_000),
    humanSec: opts.humanSec ?? 0,
    meetingSec: opts.meetingSec ?? 0,
    agentSec: opts.agentSec ?? 0,
    peak: opts.peak ?? 0,
  };
}

/** Build an array of active human rows (humanSec=60) for a range [start, end) of minute offsets. */
function activeRange(start: number, end: number, extra: Partial<Omit<MinuteRow, "t">> = {}): MinuteRow[] {
  return Array.from({ length: end - start }, (_, i) =>
    row(start + i, { humanSec: 60, ...extra }),
  );
}

// ---------------------------------------------------------------------------
// Focus XP
// ---------------------------------------------------------------------------

describe("computeFocusXp", () => {
  it("returns 0 XP for an empty array", () => {
    const result = computeFocusXp([]);
    expect(result.xp).toBe(0);
    expect(result.activeMinutes).toBe(0);
    expect(result.blocks).toBe(0);
  });

  it("treats a minute with any human time as active", () => {
    const result = computeFocusXp([row(0, { humanSec: 1 })]);
    expect(result.activeMinutes).toBe(1);
    expect(result.xp).toBe(1);
  });

  it("treats a minute spent on a call as active", () => {
    expect(computeFocusXp([row(0, { meetingSec: 60 })]).activeMinutes).toBe(1);
  });

  it("treats a minute with humanSec=0 as inactive", () => {
    const result = computeFocusXp([row(0, { humanSec: 0 })]);
    expect(result.activeMinutes).toBe(0);
    expect(result.xp).toBe(0);
  });

  it("awards 1 XP per active minute plus block bonuses", () => {
    const rows = activeRange(0, 60); // 60 active minutes in one contiguous block (≥25 → +15 bonus)
    const result = computeFocusXp(rows);
    expect(result.activeMinutes).toBe(60);
    expect(result.blocks).toBe(1);
    expect(result.xp).toBe(60 + 15); // 60 base XP + 1 block bonus
  });

  it("awards 480 XP for exactly 480 active minutes (cap boundary)", () => {
    // 480 active minutes, no focus block bonus (spread across 20 separate 24-minute runs)
    const rows: MinuteRow[] = [];
    for (let i = 0; i < 20; i++) {
      // 24 active, then big gap so they don't form a qualifying block
      rows.push(...activeRange(i * 50, i * 50 + 24));
    }
    const result = computeFocusXp(rows);
    expect(result.activeMinutes).toBe(480);
    expect(result.xp).toBe(480); // no blocks (each run is 24 < 25)
  });

  it("awards 480.5 XP for 481 active minutes (above cap boundary)", () => {
    const rows: MinuteRow[] = [];
    for (let i = 0; i < 20; i++) {
      rows.push(...activeRange(i * 50, i * 50 + 24));
    }
    // One extra active minute far away (no block bonus)
    rows.push(row(2000, { humanSec: 60 }));
    const result = computeFocusXp(rows);
    expect(result.activeMinutes).toBe(481);
    expect(result.xp).toBe(480.5);
  });

  it("awards +15 block bonus for a block of exactly 25 contiguous active minutes", () => {
    const rows = activeRange(0, 25);
    const result = computeFocusXp(rows);
    expect(result.blocks).toBe(1);
    expect(result.xp).toBe(25 + 15);
  });

  it("does NOT award a block bonus for a block of 24 contiguous active minutes", () => {
    const rows = activeRange(0, 24);
    const result = computeFocusXp(rows);
    expect(result.blocks).toBe(0);
    expect(result.xp).toBe(24);
  });

  it("allows a gap of 2 inactive minutes within a block (gap bridging)", () => {
    // 15 active + 2-minute gap + 10 active = 25 active in one block
    const rows = [...activeRange(0, 15), ...activeRange(17, 27)];
    const result = computeFocusXp(rows);
    expect(result.activeMinutes).toBe(25);
    expect(result.blocks).toBe(1);
    expect(result.xp).toBe(25 + 15);
  });

  it("breaks a block when the gap exceeds 2 inactive minutes", () => {
    // 15 active + 3-minute gap + 10 active → two separate blocks (neither ≥ 25)
    const rows = [...activeRange(0, 15), ...activeRange(18, 28)];
    const result = computeFocusXp(rows);
    expect(result.blocks).toBe(0);
    expect(result.xp).toBe(25); // 25 active minutes, no bonus
  });

  it("awards +30 XP for 2 qualifying focus blocks", () => {
    // Block 1: minutes 0–24 (25 active), gap 5 min, Block 2: minutes 30–54 (25 active)
    const rows = [...activeRange(0, 25), ...activeRange(30, 55)];
    const result = computeFocusXp(rows);
    expect(result.blocks).toBe(2);
    expect(result.xp).toBe(50 + 30); // 50 active minutes + 2×15 bonus
  });

  it("returns longestBlockSec for a multi-minute block", () => {
    const rows = activeRange(0, 25);
    const result = computeFocusXp(rows);
    expect(result.longestBlockSec).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Agent XP
// ---------------------------------------------------------------------------

describe("computeAgentXp", () => {
  it("returns 0 for empty input", () => {
    const result = computeAgentXp([]);
    expect(result.xp).toBe(0);
  });

  it("converts 120 agentSec (2 agent-min) to 0.5 XP", () => {
    const rows = [row(0, { agentSec: 120 })];
    const result = computeAgentXp(rows);
    expect(result.xp).toBeCloseTo(0.5);
  });

  it("converts 1200 agentSec (20 agent-min) to 5 XP", () => {
    const rows = [row(0, { agentSec: 1200 })];
    const result = computeAgentXp(rows);
    expect(result.xp).toBeCloseTo(5);
  });

  it("caps agent XP at 300 per day", () => {
    // 300 XP cap requires 1200 agent-minutes = 72000 agentSec
    const rows = [row(0, { agentSec: 72_000 }), row(1, { agentSec: 72_000 })];
    const result = computeAgentXp(rows);
    expect(result.xp).toBe(300);
  });

  it("rounds agentSec to whole minutes before computing XP", () => {
    // 90 agentSec → round(90/60)=2 agent-min → 0.5 XP
    const rows = [row(0, { agentSec: 90 })];
    const result = computeAgentXp(rows);
    expect(result.xp).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Orchestration XP
// ---------------------------------------------------------------------------

describe("computeOrchestrationXp", () => {
  it("returns 0 for empty input", () => {
    const result = computeOrchestrationXp([]);
    expect(result.xp).toBe(0);
  });

  it("awards 0.5 XP when peak >= 2 and human is active in the same minute", () => {
    const rows = [row(0, { peak: 2, humanSec: 60 })];
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(0.5);
  });

  it("awards 0.5 XP when human is active within +5 min of a peak-2 minute", () => {
    // Human active at t=5 (5 min after peak at t=0)
    const rows = [
      row(0, { peak: 2, humanSec: 0 }),
      row(5, { peak: 0, humanSec: 60 }),
    ];
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(0.5);
  });

  it("awards 0.5 XP when human is active within -5 min of a peak-2 minute", () => {
    // Human active at t=0, peak=2 at t=5
    const rows = [
      row(0, { humanSec: 60 }),
      row(5, { peak: 2 }),
    ];
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(0.5);
  });

  it("does NOT qualify a minute with peak=1", () => {
    const rows = [row(0, { peak: 1, humanSec: 60 })];
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(0);
  });

  it("does NOT qualify a peak-2 minute with no human activity within ±5 min", () => {
    // Human active at t=20, peak at t=0 — gap of 20 minutes
    const rows = [
      row(0, { peak: 2 }),
      row(20, { humanSec: 60 }),
    ];
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(0);
  });

  it("caps orchestration XP at 150 per day", () => {
    // 150 XP cap requires 300 qualifying minutes; create 400 qualifying minutes
    const rows: MinuteRow[] = [];
    for (let i = 0; i < 400; i++) {
      rows.push(row(i, { peak: 2, humanSec: 60 }));
    }
    const result = computeOrchestrationXp(rows);
    expect(result.xp).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Linear XP
// ---------------------------------------------------------------------------

describe("computeLinearXp", () => {
  const baseDate = new Date("2024-01-15T10:00:00Z");

  it("returns empty array for empty input", () => {
    const result = computeLinearXp([]);
    expect(result).toHaveLength(0);
  });

  it("treats null estimate as 1 — XP = 20 + 15×1 = 35", () => {
    const issues: LinearIssue[] = [
      { issueId: "ISS-1", estimate: null, completedAt: baseDate },
    ];
    const result = computeLinearXp(issues);
    expect(result).toHaveLength(1);
    expect(result[0]!.xp).toBe(35);
  });

  it("computes XP = 20 + 15×estimate for estimate=3 → 65", () => {
    const issues: LinearIssue[] = [
      { issueId: "ISS-2", estimate: 3, completedAt: baseDate },
    ];
    const result = computeLinearXp(issues);
    expect(result[0]!.xp).toBe(65);
  });

  it("caps total XP at 400 per day across all issues", () => {
    // 20 issues each with estimate=3 → raw = 20×65 = 1300 XP, capped at 400
    const issues: LinearIssue[] = Array.from({ length: 20 }, (_, i) => ({
      issueId: `ISS-${i}`,
      estimate: 3,
      completedAt: baseDate,
    }));
    const result = computeLinearXp(issues);
    const total = result.reduce((s, r) => s + r.xp, 0);
    expect(total).toBeCloseTo(400);
  });

  it("groups by the supplied local day", () => {
    const late = new Date("2026-10-05T23:30:00Z"); // Oct 5, 19:30 in New York
    const early = new Date("2026-10-06T02:00:00Z"); // Oct 5 22:00 EDT
    const result = computeLinearXp(
      [{ issueId: "A", estimate: 10, completedAt: late }, { issueId: "B", estimate: 10, completedAt: early }],
      (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d),
    );
    expect(new Set(result.map((r) => r.day))).toEqual(new Set(["2026-10-05"]));
    expect(result.reduce((s, r) => s + r.xp, 0)).toBe(340);
  });
});

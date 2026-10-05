/**
 * Level math — pure functions.
 * XP needed to go from level n to n+1 = 100 + 20n.
 * Level 1 starts at 0 XP.
 */

/** XP needed to reach the NEXT level from current level n */
export function xpForLevel(n: number): number {
  return 100 + 20 * n;
}

/** Total XP needed to reach level n (threshold) */
export function levelThreshold(n: number): number {
  if (n <= 1) return 0;
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += xpForLevel(i);
  }
  return total;
}

export interface LevelInfo {
  level: number;
  xpInLevel: number;  // XP earned within current level
  xpForNext: number;  // XP needed to reach next level
  totalXp: number;
}

/**
 * Given total XP, compute current level and progress.
 */
export function computeLevel(totalXp: number): LevelInfo {
  if (totalXp < 0) totalXp = 0;

  let level = 1;
  let remaining = totalXp;

  while (true) {
    const needed = xpForLevel(level);
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }

  return {
    level,
    xpInLevel: remaining,
    xpForNext: xpForLevel(level),
    totalXp,
  };
}

/**
 * Compute level from total XP without iterating too many times.
 * Uses the formula: sum from i=1 to n-1 of (100+20i) = 100(n-1) + 20*(n-1)*n/2
 * = (n-1)*(100 + 10n)
 * Solve: (n-1)(10n+100) = totalXp → 10n²+90n-100 = totalXp → n = (-90 + sqrt(8100 + 40*totalXp)) / 20 + 1
 */
export function computeLevelFast(totalXp: number): LevelInfo {
  return computeLevel(totalXp);
}

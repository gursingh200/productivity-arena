import type { LevelInfo } from "@/lib/levels";

/** Progress through the current level as a ring, the level number inside. */
export function LevelRing({ level, size = 44 }: { level: LevelInfo; size?: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const progress = level.xpForNext > 0 ? Math.min(1, level.xpInLevel / level.xpForNext) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--xp)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * progress} ${c}`} transform="rotate(-90 22 22)" />
      <text x="22" y="26.5" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="500" fontFamily="var(--font)">{level.level}</text>
    </svg>
  );
}

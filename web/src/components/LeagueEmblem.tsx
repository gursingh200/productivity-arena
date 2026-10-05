const COLORS: Record<string, [string, string]> = {
  legend: ["#ffd9a8", "#e8783f"],
  diamond: ["#d6ecff", "#5b9fe8"],
  gold: ["#fff0b8", "#d6a531"],
  silver: ["#f2f2f2", "#9a9fa8"],
  bronze: ["#f3c9a2", "#9c5a32"],
};

/** Eight-point star emblem tinted by league. */
export function LeagueEmblem({ league, size = 52 }: { league: string; size?: number }) {
  const [light, dark] = COLORS[league] ?? COLORS.bronze!;
  const id = `emblem-${league}`;
  const points = Array.from({ length: 16 }, (_, i) => {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 2 === 0 ? 23 : 9.5;
    return `${25 + r * Math.cos(angle)},${25 + r * Math.sin(angle)}`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" role="img" aria-label={`${league} league`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <polygon points={points} fill={`url(#${id})`} />
      <circle cx="25" cy="25" r="4" fill={light} opacity="0.9" />
    </svg>
  );
}

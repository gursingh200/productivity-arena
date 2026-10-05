/** "55.7h" — hours with one decimal (whole hours from 100h up). */
export function hours(sec: number): string {
  const h = sec / 3600;
  return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`;
}

/** "2h 33m" or "41m". */
export function duration(sec: number): string {
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** "37K", "2.4M", "812". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function percent(p: number): string {
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** Display names for agent ids. */
export function agentName(agent: string): string {
  const names: Record<string, string> = {
    claude: "Claude Code", codex: "Codex", opencode: "OpenCode", pi: "Pi", cursor: "Cursor",
    gemini: "Gemini CLI", amp: "Amp", droid: "Droid", aider: "Aider", goose: "Goose",
    crush: "Crush", qwen: "Qwen Code", "cursor-agent": "Cursor CLI",
  };
  return names[agent] ?? agent;
}

export const LEAGUE_NAMES: Record<string, string> = {
  legend: "Legend", diamond: "Diamond", gold: "Gold", silver: "Silver", bronze: "Bronze",
};

export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Hours and minutes as separate parts, for large figures: { h: "24", m: "05" }. */
export function durationParts(sec: number): { h: string; m: string } {
  const minutes = Math.round(sec / 60);
  return { h: String(Math.floor(minutes / 60)), m: String(minutes % 60).padStart(2, "0") };
}

/** Percent change, or null when there's nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

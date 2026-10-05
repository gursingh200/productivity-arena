import { duration, shortDay } from "./format";

const CELL = 20;
const DOT = 6.5;
const LEFT = 34;
const TOP = 22;
const ROW_LABELS: Record<number, string> = { 0: "Mon", 2: "Wed", 4: "Fri", 6: "Sun" };

/** Heat step for a day's human-active time (spec §7: focus heatmap). */
export function heatStep(humanSec: number): number {
  const h = humanSec / 3600;
  if (h <= 0) return 0;
  if (h < 1) return 1;
  if (h < 3) return 2;
  if (h < 5) return 3;
  if (h < 7) return 4;
  return 5;
}

/** Dot grid: one column per week (Monday at the top), one dot per day, brighter = more human time. */
export function Heatmap({ days }: { days: Array<{ day: string; sec: number }> }) {
  const dow = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  const offset = dow(days[0]!.day);
  const cells = days.map((d, i) => ({ ...d, col: Math.floor((i + offset) / 7), row: (i + offset) % 7 }));
  const columns = cells[cells.length - 1]!.col + 1;

  const months: Array<{ col: number; label: string }> = [];
  for (const c of cells) {
    const label = new Date(`${c.day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    if (months[months.length - 1]?.label !== label && (c.row === 0 || months.length === 0)) months.push({ col: c.col, label });
  }

  const width = LEFT + columns * CELL;
  const height = TOP + 7 * CELL;
  return (
    <svg className="heat" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Focus per day over the last 90 days">
      {months.map((m) => (
        <text key={`${m.label}-${m.col}`} x={LEFT + m.col * CELL + 3} y={12}>{m.label}</text>
      ))}
      {Object.entries(ROW_LABELS).map(([row, label]) => (
        <text key={row} x={0} y={TOP + Number(row) * CELL + CELL / 2 + 4}>{label}</text>
      ))}
      {cells.map((c) => (
        <circle
          key={c.day}
          cx={LEFT + c.col * CELL + CELL / 2}
          cy={TOP + c.row * CELL + CELL / 2}
          r={DOT}
          fill={`var(--heat-${heatStep(c.sec)})`}
        >
          <title>{`${shortDay(c.day)}: ${duration(c.sec)} human`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** "Less ○○○○○○ More" key for the heatmap steps. */
export function HeatScale() {
  return (
    <div className="heat-scale" aria-hidden>
      <span>Less</span>
      {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ background: `var(--heat-${i})` }} />)}
      <span>More</span>
    </div>
  );
}

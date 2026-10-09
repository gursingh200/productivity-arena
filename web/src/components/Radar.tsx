import { CATEGORY_LABEL, SKILL_SOURCES } from "@/lib/sharing";
import type { SkillsRadar } from "@/lib/skills";

/** Scores per axis; null for an axis the viewer can't see. */
export type Scores = Record<keyof SkillsRadar, number | null>;
export type Scale = "team" | "guild" | "absolute";

/** The eight axes, in radar order, with what each measures (spec §6, last 30 days) and its absolute target. */
/** `real` turns a measure (absolute scale, uncapped) back into the thing it measures, for head to head. */
export const SKILLS: Array<{ key: keyof SkillsRadar; name: string; what: string; target: string; real: (r: number) => string }> = [
  { key: "willpower", name: "Willpower", what: "Your typical longest focus block.", target: "10 = 2 hours", real: (r) => mins(r * 12) },
  { key: "consistency", name: "Consistency", what: "Weekdays with 2+ hours of your own time.", target: "10 = every weekday", real: (r) => `${Math.round(r * 10)}% of weekdays` },
  { key: "endurance", name: "Endurance", what: "Your average hours on days you worked.", target: "10 = 8 hours", real: (r) => mins(r * 48) },
  { key: "intensity", name: "Intensity", what: "Agent output tokens per agent-hour.", target: "10 = 200K", real: (r) => `${Math.round(r * 20)}K tokens/h` },
  { key: "parallelism", name: "Parallelism", what: "Total agent hours ÷ agent hours: agents and sub-agents running side by side.", target: "10 = 3×", real: (r) => `${(1 + r / 5).toFixed(1)}×` },
  { key: "competitive", name: "Competitive", what: "Share of offered quests you completed.", target: "10 = all of them; 5 until you get one", real: (r) => `${Math.round(r * 10)}% of quests` },
  { key: "camaraderie", name: "Camaraderie", what: "Your share of your guild’s hours.", target: "10 = at least an equal share", real: (r) => `${Math.round(r * 10)}% of an equal share` },
  { key: "orchestration", name: "Orchestration", what: "Agent-hours per hour of your own time.", target: "10 = 3×", real: (r) => `${(r * 0.3).toFixed(1)}×` },
];

function mins(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)}m`;
}

export const SCALE_NOTE: Record<Scale, string> = {
  team: "Ranked against everyone active in the last 30 days: 10 is the top, 0 the bottom.",
  guild: "Ranked against your guild: 10 is the top, 0 the bottom.",
  absolute: "Against fixed targets.",
};

/** One or more people on the same eight axes, 0–10 per axis. */
export function Radar({ series }: { series: Array<{ label: string; color: string; scores: Scores }> }) {
  const cx = 200;
  const cy = 190;
  const R = 130;
  const point = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / SKILLS.length - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const ring = (f: number) => SKILLS.map((_, i) => point(i, R * f).join(",")).join(" ");

  return (
    <svg className="radar" viewBox="-95 -5 590 390" role="img"
      aria-label={`Skills radar, scores 0 to 10, for ${series.map((s) => s.label).join(" and ")}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {SKILLS.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line-soft)" strokeWidth="1" />;
      })}
      {series.map((s) => {
        const values = SKILLS.map(({ key }, i) => point(i, (R * Math.max(0, Math.min(10, s.scores[key] ?? 0))) / 10));
        return (
          <g key={s.label}>
            <polygon points={values.map((p) => p.join(",")).join(" ")} fill={s.color} fillOpacity={series.length > 1 ? 0.12 : 0.18}
              stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
            {values.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="4" fill={s.color} stroke="var(--panel)" strokeWidth="2" />
            ))}
          </g>
        );
      })}
      {SKILLS.map(({ key, name }, i) => {
        const [x, y] = point(i, R + 22);
        const anchor = Math.abs(x - cx) < 10 ? "middle" : x > cx ? "start" : "end";
        return (
          <text key={key} x={x} y={y + 5} textAnchor={anchor} fill="var(--text-2)" fontSize="19">{name}</text>
        );
      })}
    </svg>
  );
}

export function SkillList({ skills, scale }: { skills: Scores; scale: Scale }) {
  return (
    <div className="skill-list">
      {SKILLS.map(({ key, name, what, target }) => (
        <div className="skill" key={key}>
          <div className="skill-top">
            <span className="skill-name">{name}</span>
            {skills[key] === null
              ? <span className="skill-score muted">–</span>
              : <span className="skill-score num">{skills[key]!.toFixed(1)}<small>/10</small></span>}
          </div>
          <div className="skill-what">
            {skills[key] === null
              ? `Hidden: it’s computed from ${SKILL_SOURCES[key].map((c) => CATEGORY_LABEL[c].toLowerCase()).join(" and ")}, which you can’t see.`
              : scale === "absolute" ? `${what} ${target}.` : what}
          </div>
        </div>
      ))}
    </div>
  );
}

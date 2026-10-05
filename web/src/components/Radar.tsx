import { CATEGORY_LABEL, SKILL_SOURCES } from "@/lib/sharing";
import type { SkillsRadar } from "@/lib/skills";

/** Scores per axis; null for an axis the viewer can't see. */
type Scores = Record<keyof SkillsRadar, number | null>;

/** The eight axes, in radar order, with what each measures (spec §6, last 30 days). */
export const SKILLS: Array<{ key: keyof SkillsRadar; name: string; what: string }> = [
  { key: "willpower", name: "Willpower", what: "Your typical longest focus block. 10 = 2 hours." },
  { key: "consistency", name: "Consistency", what: "Weekdays with 2+ hours of your own time. 10 = every weekday." },
  { key: "endurance", name: "Endurance", what: "Your average hours on days you worked. 10 = 8 hours." },
  { key: "intensity", name: "Intensity", what: "Agent output tokens per agent-hour. 10 = 200K." },
  { key: "velocity", name: "Velocity", what: "Linear issues closed per week. 10 = 10 a week." },
  { key: "competitive", name: "Competitive", what: "Share of offered quests you completed. 5 until you get one." },
  { key: "camaraderie", name: "Camaraderie", what: "Your share of your guild’s hours. 10 = at least an equal share." },
  { key: "orchestration", name: "Orchestration", what: "Agent-hours per hour of your own time. 10 = 3×." },
];

/** Eight-axis radar, 0–10 per axis. Labels only; the list beside it carries the values. */
export function Radar({ skills }: { skills: Scores }) {
  const cx = 200;
  const cy = 190;
  const R = 130;
  const point = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / SKILLS.length - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const ring = (f: number) => SKILLS.map((_, i) => point(i, R * f).join(",")).join(" ");
  const values = SKILLS.map(({ key }, i) => point(i, (R * Math.max(0, Math.min(10, skills[key] ?? 0))) / 10));

  return (
    <svg className="radar" viewBox="-95 -5 590 390" role="img" aria-label="Skills radar, scores 0 to 10">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {SKILLS.map((_, i) => {
        const [x, y] = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line-soft)" strokeWidth="1" />;
      })}
      <polygon points={values.map((p) => p.join(",")).join(" ")} fill="var(--human)" fillOpacity="0.18" stroke="var(--human)" strokeWidth="2" strokeLinejoin="round" />
      {values.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill="var(--human)" stroke="var(--panel)" strokeWidth="2" />
      ))}
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

export function SkillList({ skills }: { skills: Scores }) {
  return (
    <div className="skill-list">
      {SKILLS.map(({ key, name, what }) => (
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
              : what}
          </div>
        </div>
      ))}
    </div>
  );
}

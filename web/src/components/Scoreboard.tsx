import type { DayTotals, ProfileData } from "@/lib/profile";
import type { Category } from "@/lib/sharing";
import { NotShared } from "./NotShared";
import { change, durationParts, firstName, hours, shortDay } from "./format";

type Key = "humanSec" | "agentSec" | "meetingSec";

const FIGURES: Array<{ key: Key; label: string; tone: "human" | "agent" | "meeting"; category: Category }> = [
  { key: "humanSec", label: "Human", tone: "human", category: "human" },
  { key: "agentSec", label: "Agents", tone: "agent", category: "agents" },
  { key: "meetingSec", label: "Meetings", tone: "meeting", category: "meetings" },
];

/** This week's three headline figures, each against the same days last week. */
export function Scoreboard({ data }: { data: ProfileData }) {
  const { week, lastWeek, today } = data;
  // Days of this week so far; compare with the same days of last week.
  const todayIndex = week.days.findIndex((d) => d.day === today);
  const elapsed = todayIndex >= 0 ? todayIndex + 1 : 7;
  const soFar = (days: DayTotals[], key: Key) => days.slice(0, elapsed).reduce((s, d) => s + (d[key] ?? 0), 0);
  const peak = Math.max(1, ...week.days.flatMap((d) => [d.humanSec ?? 0, d.agentSec ?? 0, d.meetingSec ?? 0]));
  const end = week.days[week.days.length - 1]!.day;

  return (
    <section className="score" aria-label="This week">
      <div className="score-head">
        <h2 className="score-title">This week <span className="muted">{shortDay(week.start)} to {shortDay(end)}</span></h2>
        <p className="score-statement">{statement(data)}</p>
      </div>
      <div className="score-grid">
        {FIGURES.map((f) => {
          const total = week[f.key];
          return (
            <div className="figure" key={f.key}>
              <div className="figure-label"><i className={`dot dot-${f.tone}`} />{f.label}</div>
              {total === null ? (
                <div className="figure-hidden"><NotShared category={f.category} reason={data.hidden[f.category]} name={data.user.name} compact /></div>
              ) : (
                <Figure total={total} days={week.days.map((d) => d[f.key] ?? 0)} elapsed={elapsed} peak={peak} tone={f.tone}
                  pct={change(soFar(week.days, f.key), soFar(lastWeek.days, f.key))} />
              )}
              {f.key === "agentSec" && week.agentSec && week.agentWorkSec ? (
                <div className="figure-note">
                  {hours(week.agentWorkSec)} total with sub-agents, {(week.agentWorkSec / week.agentSec).toFixed(1)}× parallel
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Figure({ total, days, elapsed, peak, tone, pct }: { total: number; days: number[]; elapsed: number; peak: number; tone: string; pct: number | null }) {
  const { h, m } = durationParts(total);
  return (
    <>
      <div className="figure-value num">{h}<small>h</small> {m}<small>m</small></div>
      <div className="figure-foot">
        <div className="spark" aria-hidden>
          {days.map((sec, i) => (
            <i key={i} style={{ height: `${Math.max(3, (sec / peak) * 28)}px`, background: i < elapsed && sec > 0 ? `var(--${tone})` : undefined, color: `var(--${tone})` }} />
          ))}
        </div>
        <span className="change" title="Compared with the same days last week">
          {pct === null ? "No time last week" : <><b>{pct >= 0 ? "+" : "−"}{Math.abs(Math.round(pct))}%</b> vs last week</>}
        </span>
      </div>
    </>
  );
}

function statement(data: ProfileData): React.ReactNode {
  const { humanSec, agentSec } = data.week;
  if (humanSec === null || agentSec === null) return null;
  const whose = data.isOwner ? "Your" : `${firstName(data.user.name)}’s`;
  const you = data.isOwner ? "your" : "their";
  if (humanSec <= 0 && agentSec <= 0) return "Nothing tracked yet this week.";
  if (agentSec <= 0) return "No agent time yet this week.";
  if (humanSec <= 0) return <>{whose} agents worked <b>{Math.round(agentSec / 3600)} hours</b> this week.</>;
  const ratio = agentSec / humanSec;
  return <>{whose} agents worked <b>{ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}×</b> {you} hours this week.</>;
}

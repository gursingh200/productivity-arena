import { BLOCK_MAX_GAP_MIN, FOCUS_BLOCK_MIN } from "@/lib/game/activity";
import { ABSOLUTE, LADDER, LEAGUE_LABELS, RELATIVE, RELATIVE_MIN_PEOPLE } from "@/lib/leagues";
import { levelThreshold, xpForLevel } from "@/lib/levels";
import { QUESTS, type QuestDefinition, type QuestKind } from "@/lib/quest-engine";
import {
  AGENT_CAP_MIN, AGENT_XP_CAP, AGENT_XP_PER_MIN, FOCUS_BLOCK_XP, FOCUS_CAP_MIN, FOCUS_FULL_RATE_MIN, FOCUS_LATE_XP_PER_MIN,
  FOCUS_XP_PER_MIN, LINEAR_XP_BASE, LINEAR_XP_CAP_PER_DAY, LINEAR_XP_PER_POINT, ORCHESTRATION_WINDOW_MIN,
  ORCHESTRATION_XP_CAP, ORCHESTRATION_XP_PER_MIN,
} from "@/lib/xp-engine";

const hours = (min: number) => `${min / 60} h`;
const focusDayMax = FOCUS_FULL_RATE_MIN * FOCUS_XP_PER_MIN + (FOCUS_CAP_MIN - FOCUS_FULL_RATE_MIN) * FOCUS_LATE_XP_PER_MIN;

const EARN: Array<{ what: string; detail: string; xp: string }> = [
  {
    what: "Active minute",
    detail: `Any typing, mouse, dictation or call time in that minute. Half rate after ${hours(FOCUS_FULL_RATE_MIN)} a day; nothing after ${hours(FOCUS_CAP_MIN)} (at most ${focusDayMax} XP a day).`,
    xp: `${FOCUS_XP_PER_MIN} XP`,
  },
  {
    what: "Focus block",
    detail: `${FOCUS_BLOCK_MIN}+ active minutes in a row. Breaks of up to ${BLOCK_MAX_GAP_MIN} minutes don’t end a block.`,
    xp: `+${FOCUS_BLOCK_XP} XP`,
  },
  {
    what: "Agent minute",
    detail: `Each minute a coding agent works for you, added up across agents running at once. Counts up to ${AGENT_CAP_MIN / 60} agent-hours a day (${AGENT_XP_CAP} XP).`,
    xp: `${AGENT_XP_PER_MIN} XP`,
  },
  {
    what: "Orchestration minute",
    detail: `A minute with 2+ agents running while you were active within ${ORCHESTRATION_WINDOW_MIN} minutes. Up to ${ORCHESTRATION_XP_CAP} XP a day.`,
    xp: `+${ORCHESTRATION_XP_PER_MIN} XP`,
  },
  {
    what: "Linear issue closed",
    detail: `Per issue assigned to you; no estimate counts as 1. Reopened issues take it back. Up to ${LINEAR_XP_CAP_PER_DAY} XP a day.`,
    xp: `${LINEAR_XP_BASE} + ${LINEAR_XP_PER_POINT} × estimate`,
  },
];

const KINDS: Array<{ kind: QuestKind; title: string; how: string }> = [
  { kind: "live", title: "Live", how: "Offered on your Mac when you’re in the middle of something. Accept within 10 minutes, then finish in the time shown. One at a time." },
  { kind: "daily", title: "Daily", how: "Three a day, picked for you from this list. Linear quests only if Linear is connected." },
  { kind: "weekly", title: "Weekly", how: "Three a week, picked the same way." },
  { kind: "guild", title: "Guild", how: "One a week for your whole guild, pooled. Everyone with at least 1 hour that week gets the XP." },
];

const LEVELS = [2, 5, 10, 20, 30, 50];

export default function XpPage() {
  const quests = Object.values(QUESTS) as QuestDefinition[];
  return (
    <div style={{ margin: "0 auto", maxWidth: 760 }}>
      <h1 className="page-title">How XP works</h1>
      <p className="page-sub">
        Everything you earn, in one place. Days follow your timezone, and the weekly leaderboard adds up XP from Monday to Sunday.
      </p>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Earning XP</h2></div>
        {EARN.map((e) => (
          <div className="xp-row" key={e.what}>
            <span className="xp-reason"><b style={{ fontWeight: 500 }}>{e.what}</b><br /><span className="help">{e.detail}</span></span>
            <span className="xp-amount num">{e.xp}</span>
          </div>
        ))}
      </section>

      <h2 className="section-label">Quests</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {KINDS.map(({ kind, title, how }) => (
          <section className="panel" key={kind}>
            <div className="panel-head"><h3 className="panel-title">{title}</h3></div>
            <p className="help" style={{ marginTop: -8, marginBottom: 16 }}>{how}</p>
            {quests.filter((q) => q.kind === kind).map((q) => (
              <div className="xp-row" key={q.title}>
                <span className="xp-reason">{q.title}{q.windowMin ? <span className="muted">, within {q.windowMin} min</span> : null}</span>
                <span className="xp-amount num">+{q.xp} XP</span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <h2 className="section-label">Levels</h2>
      <section className="panel">
        <p className="help" style={{ marginTop: 0 }}>
          Going from level n to n + 1 takes 100 + 20 × n XP, so each level takes a little longer. Your level comes from all the XP you’ve ever earned.
        </p>
        <table className="table">
          <thead><tr><th>Level</th><th className="r">Total XP</th><th className="r">To the next</th></tr></thead>
          <tbody>
            {LEVELS.map((n) => (
              <tr key={n}><td>{n}</td><td className="r num">{levelThreshold(n).toLocaleString("en-US")}</td><td className="r num">{xpForLevel(n)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="section-label">Leagues</h2>
      <section className="panel">
        <p className="help" style={{ marginTop: 0 }}>
          Everyone starts in Bronze. After each week you move up or down at most one league. Under 1 hour of focus time in a
          week moves you down. A league with fewer than {RELATIVE_MIN_PEOPLE} active people uses fixed XP bars; a bigger one
          ranks its people against each other.
        </p>
        <table className="table">
          <thead><tr><th>League</th><th className="r">Small league: up at</th><th className="r">down below</th><th className="r">Big league: up</th><th className="r">down</th></tr></thead>
          <tbody>
            {LADDER.map((l) => (
              <tr key={l}>
                <td>{LEAGUE_LABELS[l]}</td>
                <td className="r num">{ABSOLUTE[l].up?.toLocaleString("en-US") ?? "–"}</td>
                <td className="r num">{ABSOLUTE[l].down?.toLocaleString("en-US") ?? "–"}</td>
                <td className="r num">{RELATIVE[l].upShare ? `Top ${RELATIVE[l].upShare * 100}%${RELATIVE[l].upFloor ? ` with ${RELATIVE[l].upFloor.toLocaleString("en-US")}+` : ""}` : "–"}</td>
                <td className="r num">{RELATIVE[l].downShare ? `Bottom ${RELATIVE[l].downShare * 100}%${RELATIVE[l].keepFloor ? ` or under ${RELATIVE[l].keepFloor.toLocaleString("en-US")}` : ""}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help" style={{ marginBottom: 0 }}>
          Away (Settings): a whole week away keeps your league; some days away lower every bar in proportion, and big
          leagues rank you on XP per day you were there. At most two whole weeks in a row.
        </p>
      </section>
    </div>
  );
}

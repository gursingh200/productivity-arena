import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { LeagueEmblem } from "@/components/LeagueEmblem";
import { compact, hours, LEAGUE_NAMES } from "@/components/format";
import { leaderboard, type LeaderboardTab } from "@/lib/leaderboard";
import { CATEGORY_LABEL } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

const TABS: Array<{ id: LeaderboardTab; label: string }> = [
  { id: "weekly_xp", label: "Weekly XP" },
  { id: "human_hours", label: "Human hours" },
  { id: "agent_hours", label: "Agent hours" },
  { id: "agent_total", label: "Total agent hours" },
  { id: "parallelism", label: "Parallelism" },
  { id: "level", label: "Level" },
];
const LEAGUES = ["all", "legend", "diamond", "gold", "silver", "bronze"] as const;
type LeagueFilter = (typeof LEAGUES)[number];

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ tab?: string; league?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const tab = TABS.find((t) => t.id === params.tab) ?? TABS[0]!;
  const league: LeagueFilter = LEAGUES.includes(params.league as LeagueFilter) ? (params.league as LeagueFilter) : "all";

  const board = await leaderboard(tab.id, viewer);
  const rows = board.locked ? [] : board.rows;
  const shown = league === "all" ? rows : rows.filter((r) => r.league === league);
  const index = LEAGUES.indexOf(league);
  const href = (next: { tab?: string; league?: string }) =>
    `/leaderboard?${new URLSearchParams({ tab: next.tab ?? tab.id, league: next.league ?? league })}`;
  const score = (value: number) =>
    tab.id === "weekly_xp" ? `${compact(value)} XP` : tab.id === "level" ? `Level ${value}`
      : tab.id === "parallelism" ? `${value.toFixed(1)}×` : hours(value);
  // On the agent-total boards the agents bar grows by the sub-agent time on top (total − clock agent hours).
  const showTotal = tab.id === "agent_total" || tab.id === "parallelism";
  const extra = (r: (typeof shown)[number]) => (showTotal ? Math.max(0, (r.weeklyAgentWorkSec ?? 0) - (r.weeklyAgentSec ?? 0)) : 0);
  // All bars share one scale so people can be compared by length.
  const maxTotal = Math.max(1, ...shown.map((r) => (r.weeklyHumanSec ?? 0) + (r.weeklyAgentSec ?? 0) + extra(r)));

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div className="board-top">
        <div>
          <h1 className="page-title">Leaderboard</h1>
          <p className="page-sub" style={{ margin: 0 }}>This week, Monday to Sunday. Leagues come from last week’s results. <Link href="/leaderboard/history" className="inline-link">Past results</Link></p>
        </div>
        <div className="league-switch">
          <Link className="icon-btn" href={href({ league: LEAGUES[Math.max(0, index - 1)] })} aria-label="Previous league" aria-disabled={index === 0}>‹</Link>
          <LeagueEmblem league={league === "all" ? board.viewerLeague : league} size={40} />
          <div>
            <div className="help">{league === "all" ? `You’re in ${LEAGUE_NAMES[board.viewerLeague]}` : "Showing"} · <Link href="/xp#leagues">How leagues work</Link></div>
            <div className="league-name">{league === "all" ? "All leagues" : `${LEAGUE_NAMES[league]} league`}</div>
          </div>
          <Link className="icon-btn" href={href({ league: LEAGUES[Math.min(LEAGUES.length - 1, index + 1)] })} aria-label="Next league" aria-disabled={index === LEAGUES.length - 1}>›</Link>
        </div>
      </div>

      <nav className="tabs" aria-label="Rank by">
        {TABS.map((t) => (
          <Link key={t.id} className="tab" href={href({ tab: t.id })} aria-current={t.id === tab.id ? "true" : undefined}>{t.label}</Link>
        ))}
      </nav>
      {tab.id === "agent_total" ? <p className="help" style={{ margin: "-6px 0 14px" }}>Every agent thread counted on its own: sub-agents running side by side each add their time. The lighter blue is the sub-agent time on top of agent hours.</p> : null}
      {tab.id === "parallelism" ? <p className="help" style={{ margin: "-6px 0 14px" }}>Total agent hours divided by agent hours. 1.0× means one thing at a time; higher means more running side by side. Needs 5 agent hours this week.</p> : null}

      <div className="board">
        {board.locked ? null : <div className="board-head">
          <span>#</span><span>Builder</span><span className="hide-sm">Human and agent hours</span><span style={{ textAlign: "right" }}>{tab.label}</span>
        </div>}
        {board.locked ? (
          <div className="locked">
            <p>This board ranks {CATEGORY_LABEL[board.category].toLowerCase()}. Share yours to see it, and to be on it.</p>
            <Link className="btn btn-sm" href="/settings/sharing">Sharing settings</Link>
          </div>
        ) : shown.length === 0 ? (
          <p className="empty" style={{ padding: "20px 18px" }}>Nobody here yet. Only people who share {CATEGORY_LABEL[board.category].toLowerCase()} appear.</p>
        ) : null}
        {shown.map((r) => (
          <Link key={r.userId} href={`/u/${r.handle}`} className={`board-row${r.userId === viewer.id ? " me" : ""}`}>
            <span className={`board-rank num${r.tabRank <= 3 ? " top" : ""}`}>{r.tabRank}</span>
            <span className="board-who">
              <Avatar name={r.name} image={r.image} size={38} />
              <span style={{ minWidth: 0 }}>
                <span className="board-name" style={{ display: "flex", alignItems: "center" }}>
                  <span className="board-name">{r.name}</span>{r.userId === viewer.id ? <span className="you">You</span> : null}{r.away ? <span className="away-badge">Away</span> : null}
                </span>
                <span className="board-sub">
                  {r.guild ? <><i className="dot" style={{ background: r.guild.color }} />{r.guild.name}</> : "No guild"}
                </span>
              </span>
            </span>
            <span className="split hide-sm">
              <span className="split-bar" aria-hidden>
                {r.weeklyHumanSec ? <span style={{ width: `${(r.weeklyHumanSec / maxTotal) * 100}%`, background: "var(--human)", color: "var(--human)" }} /> : null}
                {r.weeklyAgentSec ? <span style={{ width: `${(r.weeklyAgentSec / maxTotal) * 100}%`, background: "var(--agent)", color: "var(--agent)" }} /> : null}
                {extra(r) > 0 ? <span className="split-extra" style={{ width: `${(extra(r) / maxTotal) * 100}%` }} title="Sub-agent time on top of agent hours" /> : null}
              </span>
              <span className="split-nums num">
                <span>Human {r.weeklyHumanSec === null ? "not shared" : hours(r.weeklyHumanSec)}</span>
                <span>Agents {r.weeklyAgentSec === null ? "not shared" : hours(r.weeklyAgentSec)}</span>
                {extra(r) > 0 ? <span>Sub-agents +{hours(extra(r))}</span> : null}
              </span>
            </span>
            <span className="board-score num">{score(r.value)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { compact, hours, LEAGUE_NAMES, shortDay } from "@/components/format";
import { readHistory, saveFinishedPeriods, type Board, type Period } from "@/lib/history";
import { CATEGORY_LABEL } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

const BOARDS: Array<{ id: Board; label: string }> = [
  { id: "xp", label: "XP" },
  { id: "human", label: "Human hours" },
  { id: "agents", label: "Agent hours" },
];
const LEAGUES = ["all", "legend", "diamond", "gold", "silver", "bronze"] as const;

function periodLabel(period: Period, start: string) {
  if (period === "week") return `Week of ${shortDay(start)}`;
  return new Date(`${start}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ period?: string; board?: string; league?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const period: Period = params.period === "month" ? "month" : "week";
  const board = BOARDS.find((b) => b.id === params.board) ?? BOARDS[0]!;
  const league = period === "week" && LEAGUES.includes(params.league as (typeof LEAGUES)[number]) ? params.league! : "all";

  await saveFinishedPeriods();
  const history = await readHistory(viewer, period, board.id, league);
  const href = (next: { period?: string; board?: string; league?: string }) =>
    `/leaderboard/history?${new URLSearchParams({ period: next.period ?? period, board: next.board ?? board.id, league: next.league ?? league })}`;
  const show = (value: number) => (board.id === "xp" ? `${compact(value)} XP` : hours(value));

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <div className="board-top">
        <div>
          <h1 className="page-title">Past results</h1>
          <p className="page-sub" style={{ margin: 0 }}>The top 10 of every finished week and month. Only people who share a stat appear on its boards.</p>
        </div>
        <Link href="/leaderboard" className="btn btn-sm btn-quiet">This week</Link>
      </div>

      <nav className="tabs" aria-label="Period">
        <Link className="tab" href={href({ period: "week" })} aria-current={period === "week" ? "true" : undefined}>Weeks</Link>
        <Link className="tab" href={href({ period: "month", league: "all" })} aria-current={period === "month" ? "true" : undefined}>Months</Link>
      </nav>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <nav className="tabs" aria-label="Board">
          {BOARDS.map((b) => <Link key={b.id} className="tab" href={href({ board: b.id })} aria-current={b.id === board.id ? "true" : undefined}>{b.label}</Link>)}
        </nav>
        {period === "week" ? (
          <nav className="tabs" aria-label="League">
            {LEAGUES.map((l) => <Link key={l} className="tab" href={href({ league: l })} aria-current={l === league ? "true" : undefined}>{l === "all" ? "All leagues" : LEAGUE_NAMES[l]}</Link>)}
          </nav>
        ) : null}
      </div>

      {history.locked ? (
        <div className="locked">
          <p>These boards rank {CATEGORY_LABEL[history.category].toLowerCase()}. Share yours to see them, and to be on them.</p>
          <Link className="btn btn-sm" href="/settings/sharing">Sharing settings</Link>
        </div>
      ) : history.periods.length === 0 ? (
        <p className="empty">No finished {period}s yet. Results appear here once one ends.</p>
      ) : (
        <div className="grid12">
          {history.periods.map((p) => (
            <section className="panel c6" key={p.start}>
              <div className="panel-head">
                <h2 className="panel-title">{periodLabel(period, p.start)}</h2>
              </div>
              <TeamTotals totals={p.totals} />
              {p.rows.length === 0 ? <p className="empty">Nobody on this board.</p> : (
                <div className="rows">
                  {p.rows.map((r) => (
                    <Link href={`/u/${r.handle}`} className={`row history-row${r.userId === viewer.id ? " me" : ""}`} key={r.userId}>
                      <span className="row-main">
                        <span className={`board-rank num${r.rank <= 3 ? " top" : ""}`} style={{ width: 28 }}>{r.rank}</span>
                        <Avatar name={r.name} image={r.image} size={28} />
                        <span className="row-name">{r.name}{r.userId === viewer.id ? <span className="you">You</span> : null}</span>
                      </span>
                      <span className="row-value num">{show(r.value)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamTotals({ totals }: { totals: { xp: { value: number; people: number } | null; human: { value: number; people: number } | null; agents: { value: number; people: number } | null; meetings: { value: number; people: number } | null } }) {
  const items = [
    totals.human ? { dot: "dot-human", text: `${hours(totals.human.value)} human`, people: totals.human.people } : null,
    totals.agents ? { dot: "dot-agent", text: `${hours(totals.agents.value)} agents`, people: totals.agents.people } : null,
    totals.meetings ? { dot: "dot-meeting", text: `${hours(totals.meetings.value)} meetings`, people: totals.meetings.people } : null,
    totals.xp ? { dot: null, text: `${compact(totals.xp.value)} XP`, people: totals.xp.people } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;
  return (
    <div className="team-totals">
      {items.map((i) => (
        <span key={i.text} title={`Across the ${i.people} people sharing this`}>
          {i.dot ? <i className={`dot ${i.dot}`} /> : null}{i.text}
        </span>
      ))}
    </div>
  );
}

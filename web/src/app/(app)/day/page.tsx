import Link from "next/link";
import { agentName, duration } from "@/components/format";
import { HourChart } from "@/components/TimeCharts";
import { loadDay, pickDay } from "@/lib/day-view";
import { addDays } from "@/lib/timezone";
import { requireViewer } from "@/lib/viewer";

function longDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function time(d: Date, tz: string): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

/** Your own day: hour by hour, apps, calls, agent chats and XP. Only ever shows the signed-in person. */
export default async function DayPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const viewer = await requireViewer();
  const day = pickDay((await searchParams).d, viewer);
  const v = await loadDay(viewer, day);
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const hasPrev = prev >= v.firstDay;
  const hasNext = day < v.today;
  const yesterday = addDays(v.today, -1);

  return (
    <div style={{ margin: "0 auto", maxWidth: 1040 }}>
      <div className="day-head">
        <div>
          <h1 className="page-title">{day === v.today ? "Today" : longDay(day)}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{day === v.today ? longDay(day) : "Only you see this page."}</p>
        </div>
        <nav className="day-nav" aria-label="Choose a day">
          {hasPrev ? <Link className="icon-btn" href={`/day?d=${prev}`} aria-label="Previous day">‹</Link> : <span className="icon-btn" aria-disabled="true">‹</span>}
          <div className="seg">
            <Link href={`/day?d=${yesterday}`} aria-current={day === yesterday ? "page" : undefined}>Yesterday</Link>
            <Link href="/day" aria-current={day === v.today ? "page" : undefined}>Today</Link>
          </div>
          {hasNext ? <Link className="icon-btn" href={next === v.today ? "/day" : `/day?d=${next}`} aria-label="Next day">›</Link> : <span className="icon-btn" aria-disabled="true">›</span>}
          <form action="/day" className="day-pick">
            <input type="date" name="d" className="input" defaultValue={day} min={v.firstDay} max={v.today} aria-label="Go to a date" />
            <button className="btn btn-sm btn-quiet" type="submit">Go</button>
          </form>
        </nav>
      </div>

      <div className="totals" style={{ marginTop: 24 }}>
        <div className="fact"><div className="fact-label"><i className="dot dot-human" style={{ marginRight: 8 }} />Human</div><div className="fact-value num">{duration(v.totals.humanSec)}</div>
          <div className="help">{v.totals.focusBlocks} focus block{v.totals.focusBlocks === 1 ? "" : "s"}{v.totals.longestFocusSec ? `, longest ${duration(v.totals.longestFocusSec)}` : ""}</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-agent" style={{ marginRight: 8 }} />Agents</div><div className="fact-value num">{duration(v.totals.agentSec)}</div>
          <div className="help">{duration(v.totals.agentWorkSec)} total with sub-agents{v.totals.peakThreads > 1 ? `, up to ${v.totals.peakThreads} at once` : ""}</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-meeting" style={{ marginRight: 8 }} />Meetings</div><div className="fact-value num">{duration(v.totals.meetingSec)}</div></div>
        <div className="fact"><div className="fact-label">XP</div><div className="fact-value num">+{v.totals.xp.toLocaleString("en-US")}</div></div>
      </div>

      <div className="grid12">
        <section className="panel c12">
          <div className="panel-head"><h2 className="panel-title">Hour by hour</h2></div>
          {v.hours ? <HourChart hours={v.hours} /> : <p className="empty" style={{ margin: 0 }}>Hour-by-hour detail is kept for two weeks. This day has its totals only.</p>}
        </section>

        <section className="panel c6">
          <div className="panel-head"><h2 className="panel-title">XP earned</h2></div>
          {v.xp.length === 0 ? <p className="empty" style={{ margin: 0 }}>No XP this day.</p> : v.xp.map((r) => (
            <div className="xp-row" key={r.id}>
              <span className="xp-reason">{r.reason}</span>
              <span className="xp-amount num">{r.xp > 0 ? "+" : ""}{r.xp} XP</span>
            </div>
          ))}
        </section>

        <section className="panel c6">
          <div className="panel-head"><h2 className="panel-title">Apps</h2></div>
          {v.apps.length === 0 ? <p className="empty" style={{ margin: 0 }}>No app time this day.</p> : v.apps.map((a) => (
            <div className="xp-row" key={a.id}>
              <span className="xp-reason">{a.id === "private" ? "Private apps" : a.name ?? a.id}</span>
              <span className="num muted" style={{ textAlign: "right" }}>{duration(a.sec)}</span>
            </div>
          ))}
          {v.calls.length > 0 ? (
            <>
              <h3 className="panel-title" style={{ fontSize: 15, margin: "22px 0 8px" }}>Calls</h3>
              {v.calls.map((c) => (
                <div className="xp-row" key={c.id}>
                  <span className="xp-reason">{c.id === "private" ? "Private apps" : c.name ?? c.id}</span>
                  <span className="num muted" style={{ textAlign: "right" }}>{duration(c.sec)}</span>
                </div>
              ))}
            </>
          ) : null}
        </section>

        <section className="panel c12">
          <div className="panel-head"><h2 className="panel-title">Agent chats</h2><span className="panel-note">Chats that ran this day</span></div>
          {v.chats.length === 0 ? <p className="empty" style={{ margin: 0 }}>No agent chats this day.</p> : (
            <table className="table">
              <thead><tr><th>Agent</th><th>From</th><th>To</th><th className="r">Working time</th><th className="r">Turns</th></tr></thead>
              <tbody>
                {v.chats.map((c, i) => (
                  <tr key={i}>
                    <td>{agentName(c.agent)}</td>
                    <td className="num">{time(c.firstAt, viewer.timezone)}</td>
                    <td className="num">{time(c.lastAt, viewer.timezone)}</td>
                    <td className="r num">{duration(c.agentSec)}</td>
                    <td className="r num">{c.turns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

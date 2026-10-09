import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";
import { Avatar } from "@/components/Avatar";
import { PersonSelect } from "@/components/PersonSelect";
import { CompareHours, CompareRadar, CompareTrend, type Side } from "@/components/CompareCharts";
import { agentName, compact, duration, hours, LEAGUE_NAMES } from "@/components/format";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ACHIEVEMENTS, evaluateAchievementsIfDue, recordEvent, unlocksOf } from "@/lib/achievements";
import { headToHead, hourProfile, records } from "@/lib/compare";
import { loadProfile, type DayTotals, type ProfileData } from "@/lib/profile";
import { visibility } from "@/lib/sharing";
import { weeklyStandings } from "@/lib/standings";
import { requireViewer } from "@/lib/viewer";

const YOU = "#cc5fb8"; // magenta and gold: checked apart for colour-blind readers, always labelled too
const THEM = "#a8922c";

const sum30 = (days: DayTotals[], key: "humanSec" | "agentSec" | "meetingSec") =>
  days.some((d) => d[key] === null) ? null : days.reduce((s, d) => s + (d[key] ?? 0), 0);

function Picker({ people, note }: { people: Array<{ handle: string; name: string }>; note?: string }) {
  return (
    <div style={{ margin: "0 auto", maxWidth: 560 }}>
      <h1 className="page-title">Compare</h1>
      <p className="page-sub">Put yourself side by side with a teammate. You see a stat only when you both share it.</p>
      {note ? <p className="notice">{note}</p> : null}
      <div className="panel">
        <PersonSelect people={people} value="" param="with" path="/compare" placeholder="Choose a teammate" label="Teammate" />
      </div>
    </div>
  );
}

/** One row of the head-to-head table; null means not shared. Higher wins. */
function Row({ label, a, b, show }: { label: string; a: number | null; b: number | null; show: (n: number) => string }) {
  const lead = a === null || b === null || a === b ? 0 : a > b ? 1 : 2;
  return (
    <tr>
      <td>{label}</td>
      <td className={`r num${lead === 1 ? " vs-lead" : ""}`}>{a === null ? <span className="muted">Not shared</span> : show(a)}</td>
      <td className={`r num${lead === 2 ? " vs-lead" : ""}`}>{b === null ? <span className="muted">Not shared</span> : show(b)}</td>
    </tr>
  );
}

/** FIFA-style 1:1 (spec: social features §2). Sharing applies to every number of theirs. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const viewer = await requireViewer();
  const handle = (await searchParams).with?.split(",")[0]?.trim();
  const people = (await db.query.users.findMany({ where: isNotNull(users.handle), orderBy: [asc(users.name)] }))
    .filter((p) => p.id !== viewer.id).map((p) => ({ handle: p.handle!, name: p.name ?? p.handle! }));

  if (!handle) return <Picker people={people} />;
  if (handle === viewer.handle) {
    await recordEvent(viewer.id, "mirror"); // a secret achievement
    return <Picker people={people} note="That’s you. Pick someone else." />;
  }
  const target = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.handle, handle) });
  if (!target) return <Picker people={people} note="No one with that handle." />;
  await recordEvent(viewer.id, "compare", target.id);
  await evaluateAchievementsIfDue(viewer.id); // theirs stay current from their own uploads

  const [pa, pb] = (await Promise.all([loadProfile(viewer.handle!, viewer), loadProfile(handle, viewer)])) as [ProfileData, ProfileData];
  const see = visibility(viewer, target);
  const standings = await weeklyStandings();
  const weekly = (id: string) => standings.find((s) => s.userId === id)?.weeklyXp ?? 0;
  const a: Side = { name: "You", color: YOU };
  const b: Side = { name: pb.user.name.split(" ")[0] ?? pb.user.name, color: THEM };

  const [h2h, hoursA, hoursB, recA, recB, unlocks] = await Promise.all([
    see.xp ? headToHead(viewer.id, target.id) : null,
    see.human ? hourProfile(viewer.id, viewer.timezone) : null,
    see.human ? hourProfile(target.id, target.timezone) : null,
    records(viewer.id),
    records(target.id),
    unlocksOf([viewer.id, target.id]),
  ]);
  const gate = <T,>(ok: boolean, v: T) => (ok ? v : null);
  const mine = unlocks.get(viewer.id)!;
  const theirs = unlocks.get(target.id)!;
  // Only achievements in categories you both share, secret ones only once you've found them.
  const shown = ACHIEVEMENTS.filter((x) => see[x.category] && (!x.secret || mine.has(x.id)));
  const both = shown.filter((x) => mine.has(x.id) && theirs.has(x.id));
  const onlyYou = shown.filter((x) => mine.has(x.id) && !theirs.has(x.id));
  const onlyThem = shown.filter((x) => !mine.has(x.id) && theirs.has(x.id));
  // Null only when agents aren't visible; 0 (shown as a dash) when there was no agent time.
  const parallel = (p: ProfileData) => (p.week.agentSec === null ? null
    : p.week.agentSec > 0 && p.week.agentWorkSec ? p.week.agentWorkSec / p.week.agentSec : 0);

  return (
    <div style={{ margin: "0 auto", maxWidth: 1040 }}>
      <div className="vs-head">
        {[{ p: pa, side: a }, { p: pb, side: b }].map(({ p, side }, i) => (
          <Link key={i} href={`/u/${p.user.handle}`} className="vs-person" style={{ borderColor: side.color }}>
            <Avatar name={p.user.name} image={p.user.image} size={56} />
            <div>
              <div className="vs-name">{i === 0 ? `${p.user.name} (you)` : p.user.name}</div>
              <div className="help">{p.xp ? `Level ${p.xp.level.level}, ${LEAGUE_NAMES[p.xp.league]} league` : "XP not shared"}</div>
            </div>
          </Link>
        ))}
        <div className="day-pick">
          <PersonSelect people={people} value={handle} param="with" path="/compare" placeholder="Someone else…" label="Compare with someone else" />
        </div>
      </div>

      <div className="grid12" style={{ marginTop: 24 }}>
        <section className="panel c12">
          <div className="panel-head"><h2 className="panel-title">Skills</h2><span className="panel-note">Last 30 days</span></div>
          {pa.skills && pb.skills
            ? <CompareRadar a={a} b={b} skillsA={pa.skills} skillsB={pb.skills} />
            : <p className="empty" style={{ margin: 0 }}>Skills aren’t shared between you.</p>}
        </section>

        <section className="panel c7">
          <div className="panel-head"><h2 className="panel-title">Head to head</h2></div>
          <table className="table">
            <thead><tr><th /><th className="r">You</th><th className="r">{b.name}</th></tr></thead>
            <tbody>
              <Row label="XP this week" a={weekly(viewer.id)} b={gate(see.xp, weekly(target.id))} show={(n) => compact(n)} />
              <Row label="Level" a={pa.xp?.level.level ?? null} b={pb.xp?.level.level ?? null} show={String} />
              <Row label="Human, this week" a={pa.week.humanSec} b={pb.week.humanSec} show={hours} />
              <Row label="Human, 30 days" a={sum30(pa.last30Days, "humanSec")} b={sum30(pb.last30Days, "humanSec")} show={hours} />
              <Row label="Agents, this week" a={pa.week.agentSec} b={pb.week.agentSec} show={hours} />
              <Row label="Total agents, this week" a={pa.week.agentWorkSec} b={pb.week.agentWorkSec} show={hours} />
              <Row label="Parallelism, this week" a={parallel(pa)} b={parallel(pb)} show={(n) => (n > 0 ? `${n.toFixed(1)}×` : "–")} />
              <Row label="Agents, 30 days" a={sum30(pa.last30Days, "agentSec")} b={sum30(pb.last30Days, "agentSec")} show={hours} />
              <Row label="Meetings, this week" a={pa.week.meetingSec} b={pb.week.meetingSec} show={hours} />
            </tbody>
          </table>
        </section>

        <section className="panel c5">
          <div className="panel-head"><h2 className="panel-title">Record</h2><span className="panel-note">Weeks won on XP</span></div>
          {h2h ? (
            <div className="vs-score">
              <span className="num" style={{ color: YOU }}>{h2h.a}</span>
              <span className="muted">–</span>
              <span className="num" style={{ color: THEM }}>{h2h.b}</span>
              <p className="help" style={{ margin: "8px 0 0", gridColumn: "1 / -1" }}>
                {h2h.a + h2h.b + h2h.draws === 0 ? "No finished week where you both earned XP yet." : `${h2h.draws} drawn. Finished weeks where you both earned XP.`}
              </p>
            </div>
          ) : <p className="empty" style={{ margin: 0 }}>XP isn’t shared between you.</p>}

          <h3 className="panel-title" style={{ fontSize: 15, margin: "26px 0 8px" }}>Personal bests</h3>
          <table className="table">
            <tbody>
              <Row label="Longest streak" a={recA.longestStreak} b={gate(see.human, recB.longestStreak)} show={(n) => `${n} weekday${n === 1 ? "" : "s"}`} />
              <Row label="Longest focus block" a={recA.longestBlockSec} b={gate(see.human, recB.longestBlockSec)} show={duration} />
              <Row label="Most agents at once" a={recA.mostAgents} b={gate(see.agents, recB.mostAgents)} show={String} />
              <Row label="Best week" a={recA.bestWeekXp} b={gate(see.xp, recB.bestWeekXp)} show={(n) => `${compact(n)} XP`} />
            </tbody>
          </table>
        </section>

        <section className="panel c12">
          <div className="panel-head"><h2 className="panel-title">Over time</h2></div>
          <CompareTrend a={a} b={b} daysA={pa.history} daysB={pb.history} />
        </section>

        <section className="panel c12">
          <div className="panel-head"><h2 className="panel-title">When you work</h2><span className="panel-note">Average active minutes in each hour, last 14 days</span></div>
          {hoursA && hoursB ? <CompareHours a={a} b={b} hoursA={hoursA} hoursB={hoursB} /> : <p className="empty" style={{ margin: 0 }}>Human hours aren’t shared between you.</p>}
        </section>

        <section className="panel c6">
          <div className="panel-head"><h2 className="panel-title">Top apps</h2><span className="panel-note">Last 30 days</span></div>
          {pa.apps && pb.apps ? (
            <div className="vs-cols">
              {[pa, pb].map((p, i) => (
                <div key={i}>
                  <div className="help" style={{ marginBottom: 8, color: i === 0 ? YOU : THEM }}>{i === 0 ? "You" : b.name}</div>
                  {p.apps!.top.slice(0, 5).map((app) => (
                    <div className="vs-item" key={app.id}><span>{app.id === "private" ? "Private apps" : app.name ?? app.id}</span><span className="num muted">{Math.round(app.pct)}%</span></div>
                  ))}
                </div>
              ))}
            </div>
          ) : <p className="empty" style={{ margin: 0 }}>Apps aren’t shared between you.</p>}
        </section>

        <section className="panel c6">
          <div className="panel-head"><h2 className="panel-title">Agents</h2><span className="panel-note">Last 30 days</span></div>
          {pa.agents && pb.agents ? (
            <div className="vs-cols">
              {[pa, pb].map((p, i) => (
                <div key={i}>
                  <div className="help" style={{ marginBottom: 8, color: i === 0 ? YOU : THEM }}>{i === 0 ? "You" : b.name}</div>
                  {p.agents!.agents.slice(0, 5).map((ag) => (
                    <div className="vs-item" key={ag.agent}><span>{agentName(ag.agent)}</span><span className="num muted">{hours(ag.agentSec)}</span></div>
                  ))}
                </div>
              ))}
            </div>
          ) : <p className="empty" style={{ margin: 0 }}>Agent hours aren’t shared between you.</p>}
        </section>

        <section className="panel c12">
          <div className="panel-head">
            <h2 className="panel-title">Achievements</h2>
            <span className="panel-note">You {mine.size}, {b.name} {[...theirs.keys()].filter((id) => shown.some((x) => x.id === id)).length} that you can see</span>
          </div>
          <div className="vs-cols three">
            {[{ title: "Both", list: both }, { title: "Only you", list: onlyYou }, { title: `Only ${b.name}`, list: onlyThem }].map(({ title, list }) => (
              <div key={title}>
                <div className="help" style={{ marginBottom: 8 }}>{title} ({list.length})</div>
                {list.length === 0 ? <div className="muted" style={{ fontSize: 14 }}>None yet</div> : list.map((x) => (
                  <div className="vs-item has-tip" key={x.id} tabIndex={0}>
                    <span>{x.name}</span>
                    <span className="tip-box" role="tooltip">{x.description}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <Link href={`/achievements?vs=${handle}`} className="more-link">All achievements side by side</Link>
        </section>
      </div>
    </div>
  );
}

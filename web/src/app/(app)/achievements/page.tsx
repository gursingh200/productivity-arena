import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  ACHIEVEMENTS, evaluateAchievements, globalRates, measureAchievements, recordEvent, unlocksOf, type Achievement, type Progress,
} from "@/lib/achievements";
import { PersonSelect } from "@/components/PersonSelect";
import { CATEGORY_LABEL, visibility } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

const TONE: Record<Achievement["category"], string> = {
  human: "var(--human)", agents: "var(--agent)", meetings: "var(--meeting)", xp: "var(--xp)", apps: "var(--text-2)", skills: "var(--text-2)",
};

function day(d: Date, tz: string) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}

function amount(p: Progress, v: number): string {
  switch (p.unit) {
    case "h": return `${v < 10 ? v.toFixed(1) : Math.floor(v)}h`;
    case "min": return `${Math.floor(v)}m`;
    case "x": return `${v.toFixed(1)}×`;
    default: return String(Math.floor(v));
  }
}

/** One person's state for one achievement: when they unlocked it, or how far along they are. */
function Status({ who, unlocked, progress, tz, color }: { who: string; unlocked?: Date; progress?: Progress; tz: string; color: string }) {
  // On a phone the column headings are gone, so each status names its person.
  const name = <span className="ach-who" style={{ color }}>{who}</span>;
  if (unlocked) return <div className="ach-status got"><span className="ach-bar"><i style={{ width: "100%", background: color }} /></span><span>{name}{day(unlocked, tz)}</span></div>;
  if (!progress || progress.unit === "done") return <div className="ach-status"><span className="ach-bar"><i style={{ width: 0 }} /></span><span className="muted">{name}Not yet</span></div>;
  const pct = Math.min(100, (progress.value / progress.target) * 100);
  return (
    <div className="ach-status">
      <span className="ach-bar"><i style={{ width: `${pct}%`, background: color }} /></span>
      <span className="num muted">{name}{amount(progress, progress.value)} / {amount(progress, progress.target)}</span>
    </div>
  );
}

/**
 * Steam-style: every achievement with how rare it is (share of active people
 * who have it), and your progress beside a teammate's. Their progress shows
 * only for categories you both share; secret ones stay hidden until you find
 * them yourself.
 */
export default async function AchievementsPage({ searchParams }: { searchParams: Promise<{ vs?: string }> }) {
  const viewer = await requireViewer();
  const { vs } = await searchParams;
  const people = await db.query.users.findMany({ where: isNotNull(users.handle), orderBy: [asc(users.name)] });
  const rival = vs ? people.find((p) => p.handle === vs && p.id !== viewer.id) ?? null : null;
  // Comparing here counts toward Rivalry, same as on /compare.
  if (rival) await recordEvent(viewer.id, "compare", rival.id);
  await evaluateAchievements(viewer.id); // up to date as of now
  const see = rival ? visibility(viewer, rival) : null;

  const [{ active, counts }, unlocks, mineProgress, theirProgress] = await Promise.all([
    globalRates(),
    unlocksOf([viewer.id, ...(rival ? [rival.id] : [])]),
    measureAchievements(viewer.id),
    rival ? measureAchievements(rival.id) : Promise.resolve(null),
  ]);
  const mine = unlocks.get(viewer.id)!;
  const theirs = rival ? unlocks.get(rival.id)! : null;
  const rate = (id: string) => (counts.get(id) ?? 0) / active;
  const tz = viewer.timezone;
  // Secret ones you haven't found are one line at the end, not a wall of question marks.
  const hidden = ACHIEVEMENTS.filter((a) => a.secret && !mine.has(a.id));
  const list = ACHIEVEMENTS.filter((a) => !hidden.includes(a)).sort((a, b) => rate(a.id) - rate(b.id) || a.name.localeCompare(b.name));
  const rivalName = rival ? (rival.name ?? rival.handle!).split(" ")[0] ?? "" : "";

  return (
    <div style={{ margin: "0 auto", maxWidth: 960 }}>
      <div className="day-head">
        <div>
          <h1 className="page-title">Achievements</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            You’ve unlocked <b>{mine.size}</b> of {ACHIEVEMENTS.length}. Rarest first; the percentage is how many of the {active} active people have each one.
          </p>
        </div>
        <div className="day-pick">
          <PersonSelect people={people.filter((p) => p.id !== viewer.id).map((p) => ({ handle: p.handle!, name: p.name ?? p.handle! }))}
            value={rival?.handle ?? ""} param="vs" path="/achievements" placeholder="Compare with…" label="Compare with" />
        </div>
      </div>

      <section className={`panel ach-list${rival ? " vs" : ""}`} style={{ marginTop: 24 }}>
        <div className="ach ach-head" aria-hidden>
          <span />
          <span>Achievement</span>
          <span className="r">Have it</span>
          <span><i className="dot" style={{ background: "#cc5fb8" }} />You</span>
          {rival ? <span><i className="dot" style={{ background: "#a8922c" }} />{rivalName}</span> : null}
        </div>
        {list.map((a) => {
          const got = mine.get(a.id);
          const pct = Math.round(rate(a.id) * 100);
          const theirsVisible = see ? see[a.category] : false;
          return (
            <div className={`ach${got ? " got" : ""}`} key={a.id}>
              <span className="ach-icon" style={{ borderColor: got ? TONE[a.category] : undefined, color: got ? TONE[a.category] : undefined }} aria-hidden>
                {a.name.charAt(0)}
              </span>
              <div className="ach-body">
                <div className="ach-name">{a.name}{a.secret ? <span className="you">Secret</span> : null}</div>
                <div className="help">{a.description}</div>
              </div>
              <div className="num ach-rate-num">{pct}%</div>
              <Status who="You" unlocked={got} progress={mineProgress.get(a.id)} tz={tz} color="#cc5fb8" />
              {rival ? (
                theirsVisible
                  ? <Status who={rivalName} unlocked={theirs!.get(a.id)} progress={theirProgress?.get(a.id)} tz={tz} color="#a8922c" />
                  : <div className="ach-status"><span className="muted">{CATEGORY_LABEL[a.category]} not shared</span></div>
              ) : null}
            </div>
          );
        })}
        {hidden.length ? (
          <div className="ach">
            <span className="ach-icon" aria-hidden>?</span>
            <div className="ach-body">
              <div className="ach-name">{hidden.length} hidden achievement{hidden.length === 1 ? "" : "s"}</div>
              <div className="help">Secret until you find them. Keep using Arena; some are easter eggs.</div>
            </div>
          </div>
        ) : null}
      </section>
      {rival ? <Link href={`/compare?with=${rival.handle}`} className="more-link">Full comparison with {rivalName}</Link> : null}
    </div>
  );
}

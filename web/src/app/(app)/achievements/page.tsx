import { asc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ACHIEVEMENT_BY_ID, ACHIEVEMENTS, evaluateAchievements, globalRates, unlocksOf, type Achievement } from "@/lib/achievements";
import { CATEGORY_LABEL, visibility } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";

const TONE: Record<Achievement["category"], string> = {
  human: "var(--human)", agents: "var(--agent)", meetings: "var(--meeting)", xp: "var(--xp)", apps: "var(--text-2)", skills: "var(--text-2)",
};

function day(d: Date, tz: string) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz });
}

/**
 * Every achievement with how rare it is (share of active people who have it),
 * yours with the date, and optionally a teammate's beside yours. Their unlocks
 * show only for categories you both share; secret ones stay hidden until you
 * find them yourself.
 */
export default async function AchievementsPage({ searchParams }: { searchParams: Promise<{ vs?: string }> }) {
  const viewer = await requireViewer();
  await evaluateAchievements(viewer.id); // up to date as of now
  const { vs } = await searchParams;
  const people = await db.query.users.findMany({ where: isNotNull(users.handle), orderBy: [asc(users.name)] });
  const rival = vs ? people.find((p) => p.handle === vs && p.id !== viewer.id) ?? null : null;
  const see = rival ? visibility(viewer, rival) : null;

  const { active, counts } = await globalRates();
  const unlocks = await unlocksOf([viewer.id, ...(rival ? [rival.id] : [])]);
  const mine = unlocks.get(viewer.id)!;
  const theirs = rival ? unlocks.get(rival.id)! : null;
  const rate = (id: string) => (counts.get(id) ?? 0) / active;
  const list = [...ACHIEVEMENTS].sort((a, b) => rate(a.id) - rate(b.id) || a.name.localeCompare(b.name));
  const tz = viewer.timezone;

  return (
    <div style={{ margin: "0 auto", maxWidth: 860 }}>
      <div className="day-head">
        <div>
          <h1 className="page-title">Achievements</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            You’ve unlocked <b>{mine.size}</b> of {ACHIEVEMENTS.length}. Rarest first; the percentage is how many of the {active} active
            people have each one.
          </p>
        </div>
        <form action="/achievements" className="day-pick">
          <select name="vs" className="input" defaultValue={rival?.handle ?? ""} aria-label="Compare with">
            <option value="">Compare with…</option>
            {people.filter((p) => p.id !== viewer.id).map((p) => <option key={p.id} value={p.handle!}>{p.name ?? p.handle}</option>)}
          </select>
          <button className="btn btn-sm btn-quiet" type="submit">Compare</button>
        </form>
      </div>

      {rival ? (
        <p className="help" style={{ margin: "18px 0 0" }}>
          You and {rival.name ?? rival.handle}: you have {mine.size}, they have {[...theirs!.keys()].filter((id) => { const a = ACHIEVEMENT_BY_ID.get(id); return a !== undefined && see![a.category]; }).length} you can see.
        </p>
      ) : null}

      <section className="panel" style={{ marginTop: 24 }}>
        {list.map((a) => {
          const got = mine.get(a.id);
          const hidden = a.secret && !got;
          const pct = Math.round(rate(a.id) * 100);
          const them = theirs?.get(a.id);
          const theirsVisible = see ? see[a.category] : false;
          return (
            <div className={`ach${got ? " got" : ""}`} key={a.id}>
              <span className="ach-icon" style={{ borderColor: got ? TONE[a.category] : undefined, color: got ? TONE[a.category] : undefined }} aria-hidden>
                {hidden ? "?" : a.name.charAt(0)}
              </span>
              <div className="ach-body">
                <div className="ach-name">{hidden ? "Hidden achievement" : a.name}</div>
                <div className="help">{hidden ? "Keep using Arena to find it." : a.description}</div>
                <div className="ach-rate" aria-label={`${pct}% of active people`}>
                  <span style={{ width: `${Math.max(pct, 1)}%` }} />
                </div>
              </div>
              <div className="ach-side">
                <div className="num">{pct}%</div>
                <div className="help">{got ? `You, ${day(got, tz)}` : "Not yet"}</div>
                {rival ? (
                  <div className="help">
                    {!theirsVisible ? `${CATEGORY_LABEL[a.category]} not shared` : them ? `${rival.name?.split(" ")[0] ?? rival.handle}, ${day(them, tz)}` : "Not them yet"}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

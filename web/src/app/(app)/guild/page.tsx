import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { Avatar } from "@/components/Avatar";
import { compact, hours } from "@/components/format";
import { db } from "@/db";
import { dailyRollup, guilds, users, xpLedger } from "@/db/schema";
import { isGuildAdmin } from "@/lib/roles";
import { visibility } from "@/lib/sharing";
import { weekDays } from "@/lib/standings";
import { addDays } from "@/lib/timezone";
import { requireViewer } from "@/lib/viewer";
import AddMember from "./AddMember";

/**
 * A guild admin's view of their guild: the guild's totals for this week and
 * the last four, each member's week, and adding people who have no guild yet.
 * Totals add up only people who share each category; member numbers follow the
 * usual give-to-get rules.
 */
export default async function GuildPage() {
  const viewer = await requireViewer();
  if (!isGuildAdmin(viewer)) redirect("/");
  const guild = (await db.query.guilds.findFirst({ where: eq(guilds.id, viewer.guildId!) }))!;
  const members = await db.query.users.findMany({ where: eq(users.guildId, guild.id), orderBy: (u, { asc }) => [asc(u.name)] });
  const unassigned = await db.select({ id: users.id, name: users.name, handle: users.handle }).from(users)
    .where(isNull(users.guildId)).orderBy(users.name);

  const { thisWeek } = weekDays(new Date());
  const from = addDays(thisWeek, -28);
  const ids = members.map((m) => m.id);
  const days = ids.length ? await db.select({
    userId: dailyRollup.userId, day: dailyRollup.day, human: dailyRollup.humanSec, agent: dailyRollup.agentSec,
    work: dailyRollup.agentWorkSec, meeting: dailyRollup.meetingSec,
  }).from(dailyRollup).where(and(inArray(dailyRollup.userId, ids), gte(dailyRollup.day, from))) : [];
  const xp = ids.length ? await db.select({ userId: xpLedger.userId, day: xpLedger.day, xp: sql<number>`SUM(${xpLedger.xp})` })
    .from(xpLedger).where(and(inArray(xpLedger.userId, ids), gte(xpLedger.day, from), lt(xpLedger.day, addDays(thisWeek, 7))))
    .groupBy(xpLedger.userId, xpLedger.day) : [];

  // Totals count a member only for categories they share (and you share).
  const sees = new Map(members.map((m) => [m.id, visibility(viewer, m)]));
  const weeks = [0, 1, 2, 3, 4].map((n) => addDays(thisWeek, -7 * n));
  const totalFor = (week: string) => {
    const end = addDays(week, 7);
    const inWeek = days.filter((d) => d.day >= week && d.day < end);
    const sum = (pick: (d: (typeof days)[number]) => number, cat: "human" | "agents" | "meetings") =>
      inWeek.filter((d) => sees.get(d.userId)![cat]).reduce((s, d) => s + pick(d), 0);
    return {
      week,
      human: sum((d) => d.human, "human"),
      agent: sum((d) => d.agent, "agents"),
      work: sum((d) => Math.max(d.work, d.agent), "agents"),
      meeting: sum((d) => d.meeting, "meetings"),
      xp: xp.filter((r) => r.day >= week && r.day < end && sees.get(r.userId)!.xp).reduce((s, r) => s + Number(r.xp), 0),
    };
  };
  const totals = weeks.map(totalFor);
  const memberWeek = (id: string) => {
    const see = sees.get(id)!;
    const mine = days.filter((d) => d.userId === id && d.day >= thisWeek);
    return {
      human: see.human ? mine.reduce((s, d) => s + d.human, 0) : null,
      agent: see.agents ? mine.reduce((s, d) => s + d.agent, 0) : null,
      meeting: see.meetings ? mine.reduce((s, d) => s + d.meeting, 0) : null,
      xp: see.xp ? xp.filter((r) => r.userId === id && r.day >= thisWeek).reduce((s, r) => s + Number(r.xp), 0) : null,
    };
  };
  const cell = (v: number | null, show: (n: number) => string) => (v === null ? <span className="muted">–</span> : show(v));
  const label = (week: string) => (week === thisWeek ? "This week" : `Week of ${new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`);

  return (
    <div style={{ margin: "0 auto", maxWidth: 1040 }}>
      <h1 className="page-title"><i className="dot" style={{ background: guild.color, width: 12, height: 12, marginRight: 12 }} />{guild.name}</h1>
      <p className="page-sub">{members.length} member{members.length === 1 ? "" : "s"}. You’re this guild’s admin. Totals add up the people who share each number with you.</p>

      <div className="totals">
        <div className="fact"><div className="fact-label"><i className="dot dot-human" style={{ marginRight: 8 }} />Human this week</div><div className="fact-value num">{hours(totals[0]!.human)}</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-agent" style={{ marginRight: 8 }} />Agents this week</div><div className="fact-value num">{hours(totals[0]!.agent)}</div><div className="help">{hours(totals[0]!.work)} with sub-agents</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-meeting" style={{ marginRight: 8 }} />Meetings this week</div><div className="fact-value num">{hours(totals[0]!.meeting)}</div></div>
        <div className="fact"><div className="fact-label">XP this week</div><div className="fact-value num">{compact(totals[0]!.xp)}</div></div>
      </div>

      <div className="grid12">
        <section className="panel c7">
          <div className="panel-head"><h2 className="panel-title">Members this week</h2></div>
          <table className="table">
            <thead><tr><th>Member</th><th className="r">Human</th><th className="r">Agents</th><th className="r">Meetings</th><th className="r">XP</th></tr></thead>
            <tbody>
              {members.map((m) => {
                const w = memberWeek(m.id);
                return (
                  <tr key={m.id}>
                    <td><Link href={`/u/${m.handle}`} className="team-person"><Avatar name={m.name} image={m.image} size={26} /><span>{m.name ?? m.handle}{m.guildAdmin ? <span className="you">Guild admin</span> : null}</span></Link></td>
                    <td className="r num">{cell(w.human, hours)}</td>
                    <td className="r num">{cell(w.agent, hours)}</td>
                    <td className="r num">{cell(w.meeting, hours)}</td>
                    <td className="r num">{cell(w.xp, compact)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="panel c5">
          <div className="panel-head"><h2 className="panel-title">Last five weeks</h2></div>
          <table className="table">
            <thead><tr><th>Week</th><th className="r">Human</th><th className="r">Agents</th><th className="r">XP</th></tr></thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.week}><td>{label(t.week)}</td><td className="r num">{hours(t.human)}</td><td className="r num">{hours(t.agent)}</td><td className="r num">{compact(t.xp)}</td></tr>
              ))}
            </tbody>
          </table>

          <h3 className="panel-title" style={{ fontSize: 15, margin: "26px 0 10px" }}>Add someone</h3>
          {unassigned.length === 0
            ? <p className="empty" style={{ margin: 0 }}>Everyone is already in a guild.</p>
            : <AddMember people={unassigned.map((u) => ({ id: u.id, name: u.name ?? u.handle ?? "Someone" }))} />}
        </section>
      </div>
    </div>
  );
}

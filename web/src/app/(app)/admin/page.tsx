import { and, gte, isNull, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { compact, hours, shortDay } from "@/components/format";
import { db } from "@/db";
import { dailyRollup, devices, guilds, xpLedger } from "@/db/schema";
import { weekDays } from "@/lib/standings";
import { addDays } from "@/lib/timezone";
import { visibility } from "@/lib/sharing";
import { requireViewer } from "@/lib/viewer";
import GuildManager from "./GuildManager";
import { isAdmin, isOwner } from "@/lib/roles";

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

function synced(d: Date | null) {
  if (!d) return "Never";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return `${Math.round(min / 1440)}d ago`;
}

/** Team table: human and agent hours per person for one company week (spec §7). */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) redirect("/");

  const { thisWeek } = weekDays(new Date());
  const requested = (await searchParams).week;
  // Only Mondays on or before this week are valid; anything else falls back to this week.
  const offset = requested && WEEK.test(requested) ? Math.round((Date.parse(thisWeek) - Date.parse(requested)) / (7 * 86_400_000)) : 0;
  const weeksBack = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const week = addDays(thisWeek, -7 * weeksBack);
  const weekEnd = addDays(week, 7);

  const people = await db.query.users.findMany({ with: { guild: true } });
  const allGuilds = await db.select().from(guilds).orderBy(guilds.name);
  const time = await db.select({
    userId: dailyRollup.userId,
    human: sql<number>`SUM(${dailyRollup.humanSec})`,
    agent: sql<number>`SUM(${dailyRollup.agentSec})`,
    meeting: sql<number>`SUM(${dailyRollup.meetingSec})`,
    peak: sql<number>`MAX(${dailyRollup.peakParallel})`,
    activeDays: sql<number>`COUNT(*) FILTER (WHERE ${dailyRollup.humanSec} > 0)`,
  }).from(dailyRollup).where(and(gte(dailyRollup.day, week), lt(dailyRollup.day, weekEnd))).groupBy(dailyRollup.userId);
  const xp = await db.select({ userId: xpLedger.userId, xp: sql<number>`SUM(${xpLedger.xp})` })
    .from(xpLedger).where(and(gte(xpLedger.day, week), lt(xpLedger.day, weekEnd))).groupBy(xpLedger.userId);
  const seen = await db.select({ userId: devices.userId, last: sql<Date | null>`MAX(${devices.lastSeenAt})` })
    .from(devices).where(isNull(devices.revokedAt)).groupBy(devices.userId);

  const timeBy = new Map(time.map((t) => [t.userId, t]));
  const xpBy = new Map(xp.map((x) => [x.userId, Number(x.xp)]));
  const seenBy = new Map(seen.map((s) => [s.userId, s.last ? new Date(s.last) : null]));
  // Admins follow the same give-to-get rules: a cell is null unless both share it.
  const rows = people.map((u) => {
    const t = timeBy.get(u.id);
    const see = visibility(viewer, u);
    return {
      user: u,
      human: see.human ? Number(t?.human ?? 0) : null,
      agent: see.agents ? Number(t?.agent ?? 0) : null,
      meeting: see.meetings ? Number(t?.meeting ?? 0) : null,
      peak: see.agents ? Number(t?.peak ?? 0) : null,
      activeDays: see.human ? Number(t?.activeDays ?? 0) : null,
      xp: see.xp ? xpBy.get(u.id) ?? 0 : null,
      lastSync: seenBy.get(u.id) ?? null,
    };
  }).sort((a, b) => (b.human ?? 0) + (b.agent ?? 0) - ((a.human ?? 0) + (a.agent ?? 0)));

  const total = (pick: (r: (typeof rows)[number]) => number | null) => {
    const shown = rows.map(pick).filter((v): v is number => v !== null);
    return { sec: shown.reduce((s, v) => s + v, 0), people: shown.length };
  };
  const team = { human: total((r) => r.human), agent: total((r) => r.agent), meeting: total((r) => r.meeting) };
  const active = rows.filter((r) => (r.human ?? 0) > 0).length;
  const cell = (v: number | null, show: (n: number) => string) => (v === null ? <span className="muted">–</span> : show(v));

  return (
    <div style={{ margin: "0 auto", maxWidth: 1100 }}>
      <h1 className="page-title">Team</h1>
      <p className="page-sub">Human, agent and meeting hours per person, week by week. Only admins see this page, and it follows the same sharing rules as everything else: you see a number only when both of you share it.</p>

      <div className="week-nav">
        <Link className="icon-btn" href={`/admin?week=${addDays(week, -7)}`} aria-label="Previous week">‹</Link>
        <div>
          <div className="help">{weeksBack === 0 ? "This week" : `${weeksBack} week${weeksBack > 1 ? "s" : ""} ago`}</div>
          <div className="label">{shortDay(week)} to {shortDay(addDays(week, 6))}</div>
        </div>
        <Link className="icon-btn" href={weeksBack === 1 ? "/admin" : `/admin?week=${addDays(week, 7)}`} aria-label="Next week" aria-disabled={weeksBack === 0}>›</Link>
      </div>

      <div className="totals">
        <div className="fact"><div className="fact-label"><i className="dot dot-human" style={{ marginRight: 8 }} />Human hours</div><div className="fact-value num">{hours(team.human.sec)}</div><div className="help">{team.human.people} sharing</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-agent" style={{ marginRight: 8 }} />Agent hours</div><div className="fact-value num">{hours(team.agent.sec)}</div><div className="help">{team.agent.people} sharing</div></div>
        <div className="fact"><div className="fact-label"><i className="dot dot-meeting" style={{ marginRight: 8 }} />Meeting hours</div><div className="fact-value num">{hours(team.meeting.sec)}</div><div className="help">{team.meeting.people} sharing</div></div>
        <div className="fact"><div className="fact-label">Active people</div><div className="fact-value num">{active} of {rows.length}</div></div>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="table team-table">
          <thead>
            <tr>
              <th>Person</th><th className="r"><i className="dot dot-human" style={{ marginRight: 7 }} />Human</th><th className="r"><i className="dot dot-agent" style={{ marginRight: 7 }} />Agents</th><th className="r"><i className="dot dot-meeting" style={{ marginRight: 7 }} />Meetings</th><th className="r">Agent ÷ human</th>
              <th className="r">Active days</th><th className="r">Peak parallel</th><th className="r">XP</th><th className="r">Last sync</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user.id}>
                <td>
                  <Link href={`/u/${r.user.handle}`} className="team-person">
                    <Avatar name={r.user.name} image={r.user.image} size={28} />
                    <span className="team-who">
                      <span className="team-name">{r.user.name ?? `@${r.user.handle}`}</span>
                      <span className="help">{r.user.guild?.name ?? "No guild"}{r.user.role === "owner" ? ", owner" : r.user.role === "admin" ? ", admin" : ""}{r.user.guildAdmin ? ", guild admin" : ""}</span>
                    </span>
                  </Link>
                </td>
                <td className="r num">{cell(r.human, hours)}</td>
                <td className="r num">{cell(r.agent, hours)}</td>
                <td className="r num">{cell(r.meeting, hours)}</td>
                <td className="r num">{r.human !== null && r.agent !== null && r.human > 0 ? `${(r.agent / r.human).toFixed(1)}×` : <span className="muted">–</span>}</td>
                <td className="r num">{cell(r.activeDays, String)}</td>
                <td className="r num">{cell(r.peak, (n) => (n ? String(n) : "–"))}</td>
                <td className="r num">{cell(r.xp, compact)}</td>
                <td className="r num muted">{synced(r.lastSync)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-label">Guilds</h2>
      <p className="help" style={{ marginTop: -6, marginBottom: 14 }}>Each guild gets one shared quest a week. When it’s done, everyone in it with at least 1 hour that week gets the XP.</p>
      <GuildManager
        guilds={allGuilds.map((g) => ({ id: g.id, name: g.name, members: people.filter((p) => p.guildId === g.id).length }))}
        canSetRoles={isOwner(viewer)}
        people={people.map((p) => ({ id: p.id, name: p.name ?? `@${p.handle}`, guildId: p.guildId, guildAdmin: p.guildAdmin, role: p.role }))
          .sort((a, b) => a.name.localeCompare(b.name))}
      />
    </div>
  );
}

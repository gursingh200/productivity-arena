import Link from "next/link";
import { TapBadge } from "./EasterEggs";
import type { ProfileData } from "@/lib/profile";
import { Avatar } from "./Avatar";
import { LeagueEmblem } from "./LeagueEmblem";
import { LevelRing } from "./LevelRing";
import { compact, LEAGUE_NAMES } from "./format";

/** Who this is and, when XP is visible, their level and league standing. */
export function ProfileHero({ data }: { data: ProfileData }) {
  const { user, xp } = data;
  return (
    <section className="hero">
      <div className="hero-who">
        <Avatar name={user.name} image={user.image} size={72} />
        <div style={{ minWidth: 0 }}>
          <h1 className="hero-name">{user.name}{user.away ? <span className="away-badge">Away</span> : null}</h1>
          <div className="hero-meta">
            <span>@{user.handle}</span>
            {user.guild ? <span className="guild"><i className="dot" style={{ background: user.guild.color }} />{user.guild.name}</span> : null}
            {user.bio ? <span>{user.bio}</span> : null}
          </div>
        </div>
      </div>
      {xp ? (
        <div className="hero-side">
          <div className="badge">
            <LevelRing level={xp.level} />
            <div>
              <div className="badge-label">Level {xp.level.level}</div>
              <div className="badge-value num">{compact(xp.level.xpForNext - xp.level.xpInLevel)} XP to {xp.level.level + 1}</div>
            </div>
          </div>
          <div className="badge">
            {data.isOwner ? <TapBadge><LeagueEmblem league={xp.league} size={40} /></TapBadge> : <LeagueEmblem league={xp.league} size={40} />}
            <div>
              <div className="badge-label"><Link href="/xp#leagues">{LEAGUE_NAMES[xp.league]} league</Link></div>
              <div className="badge-value num">
                {xp.rank ? `#${xp.rank.rank} of ${xp.rank.of} this week` : data.isOwner ? <Link href="/settings#sharing">Share XP to be ranked</Link> : "Not ranked"}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import type { Quest } from "@/db/schema";
import type { ProfileData } from "@/lib/profile";
import type { Category } from "@/lib/sharing";
import { NotShared } from "./NotShared";
import { ActivityChart } from "./ActivityChart";
import { TrendChart } from "./TimeCharts";
import { AgentsPanel } from "./AgentsPanel";
import { AppsPanel } from "./AppsPanel";
import { Heatmap, HeatScale } from "./Heatmap";
import { ProfileHero } from "./ProfileHero";
import { QuestList } from "./QuestList";
import { Radar, SkillList } from "./Radar";
import { Scoreboard } from "./Scoreboard";
import { XpLog } from "./XpLog";
import { change, hours } from "./format";
import { toQuestItems } from "./quest-items";

function Panel({ title, note, className, children }: { title: string; note?: string; className: string; children: React.ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {note ? <span className="panel-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The full profile, shared by "/" (your own) and "/u/[handle]". Hidden categories show who hid them. */
export function ProfileView({ data }: { data: ProfileData }) {
  const { human, xp } = data;
  const focusChange = human ? change(human.weeklyAvgSec, human.previousWeeklyAvgSec) : null;
  const anyDaily = data.visible.human || data.visible.agents || data.visible.meetings;
  const hiddenNote = (category: Category) => <NotShared category={category} reason={data.hidden[category]} name={data.user.name} />;
  return (
    <>
      <ProfileHero data={data} />
      <Scoreboard data={data} />

      <div className="grid12">
        <Panel title="Human, agents and meetings" note="Last 30 days" className="c8">
          {anyDaily ? <ActivityChart days={data.last30Days} linkDays={data.isOwner} /> : hiddenNote("human")}
        </Panel>
        {data.isOwner && xp ? (
          <Panel title="Quests" className="c4">
            <QuestList quests={toQuestItems(profileQuests(xp.quests))} interactive />
            {xp.quests.length > profileQuests(xp.quests).length ? (
              <Link href="/quests" className="more-link">All {xp.quests.length} quests</Link>
            ) : null}
          </Panel>
        ) : (
          <Panel title="Recent XP" className="c4">
            {xp ? <XpLog rows={xp.recentXp.slice(0, 5)} /> : hiddenNote("xp")}
          </Panel>
        )}

        {anyDaily ? (
          <Panel title="Over time" note={data.isOwner ? "Your trend since you started" : "Since they started"} className="c12">
            <TrendChart days={data.history} />
          </Panel>
        ) : null}

        <Panel title="Focus" note="Last 90 days" className="c8">
          {human ? (
            <div className="heat-wrap">
              <div className="stat-stack">
                <div>
                  <div className="stat-big num">{hours(human.weeklyAvgSec)}</div>
                  <div className="stat-cap">Human time per week, on average</div>
                </div>
                <div>
                  <div className="stat-big num">{focusChange === null ? "–" : `${focusChange >= 0 ? "+" : "−"}${Math.abs(Math.round(focusChange))}%`}</div>
                  <div className="stat-cap">Compared with the 90 days before</div>
                </div>
              </div>
              <div>
                <Heatmap days={human.days90} />
                <HeatScale />
              </div>
            </div>
          ) : hiddenNote("human")}
        </Panel>
        <div className="c4">
          <AppsPanel data={data} />
        </div>

        <Panel title="Skills" note="Last 30 days, each scored out of 10" className="c12">
          {data.skills ? (
            <div className="skills">
              <Radar skills={data.skills} />
              <SkillList skills={data.skills} />
            </div>
          ) : hiddenNote("skills")}
        </Panel>

        <div className={data.isOwner ? "c8" : "c12"}>
          <AgentsPanel data={data} />
        </div>
        {data.isOwner && xp ? (
          <Panel title="Recent XP" className="c4">
            <XpLog rows={xp.recentXp.slice(0, 7)} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}

/** Offers first, then the open quests closest to done; four at most. */
function profileQuests(quests: Quest[]): Quest[] {
  const offered = quests.filter((q) => q.state === "offered");
  const open = quests.filter((q) => q.state === "active")
    .sort((a, b) => b.progress / b.target - a.progress / a.target);
  return [...offered, ...open].slice(0, 4);
}

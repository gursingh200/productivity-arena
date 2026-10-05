import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quests } from "@/db/schema";
import { QuestList } from "@/components/QuestList";
import { toQuestItems } from "@/components/quest-items";
import { shortDay } from "@/components/format";
import { questsForUser } from "@/lib/quest-db";
import { requireViewer } from "@/lib/viewer";

const OUTCOME: Record<string, string> = { completed: "Completed", failed: "Missed", expired: "Offer expired", declined: "Declined" };

export default async function QuestsPage() {
  const viewer = await requireViewer();
  const open = await questsForUser(viewer.id, viewer.guildId);
  const history = await db.query.quests.findMany({
    where: and(eq(quests.userId, viewer.id), inArray(quests.state, ["completed", "failed", "expired", "declined"])),
    orderBy: desc(quests.resolvedAt),
    limit: 20,
  });

  return (
    <div className="page-narrow">
      <h1 className="page-title">Quests</h1>
      <p className="page-sub">Live quests pop up on your Mac while you work. Daily, weekly and guild quests track themselves.</p>
      <div className="grid12">
        <section className="panel c7">
          <div className="panel-head"><h2 className="panel-title">Open</h2></div>
          <QuestList quests={toQuestItems(open)} interactive grouped />
        </section>
        <section className="panel c5">
          <div className="panel-head"><h2 className="panel-title">Finished</h2><span className="panel-note">Last 20</span></div>
          {history.length === 0 ? <p className="empty">Finished quests show up here.</p> : null}
          {history.map((q) => (
            <div className="xp-row" key={q.id}>
              <span className="xp-reason">{q.title}</span>
              <span className={q.state === "completed" ? "xp-amount num" : "muted"} style={{ textAlign: "right" }}>{q.state === "completed" ? `+${q.xp} XP` : OUTCOME[q.state]}</span>
              <span className="xp-day">{q.resolvedAt ? shortDay(q.resolvedAt.toISOString().slice(0, 10)) : ""}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

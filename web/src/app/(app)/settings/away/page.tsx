import { awayInWeek, workDays } from "@/lib/league-db";
import { companyTimezone, weekDays } from "@/lib/standings";
import { toUserDay } from "@/lib/timezone";
import { requireViewer } from "@/lib/viewer";
import AwayForm from "../AwayForm";

export default async function AwaySettingsPage() {
  const viewer = await requireViewer();
  const now = new Date();
  const { thisWeek, nextWeek } = weekDays(now);
  const isMonday = toUserDay(now, companyTimezone()) === thisWeek;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const awayWeeks = await Promise.all(([["this", thisWeek, "This week"], ["next", nextWeek, "Next week"]] as const).map(async ([key, week, label]) => ({
    key, label, locked: key === "this" && !isMonday,
    days: workDays(week).map((day) => ({ day, label: dayLabel(day) })),
    away: await awayInWeek(viewer.id, week),
  })));
  return (
    <div className="panel">
      <p className="help" style={{ marginTop: 0 }}>
        Mark weekdays you’re away. A whole week away keeps your league as it is; some days away lower the XP you need
        in proportion. Teammates see “Away” on those days. At most two whole weeks in a row.
      </p>
      <AwayForm weeks={awayWeeks} />
    </div>
  );
}

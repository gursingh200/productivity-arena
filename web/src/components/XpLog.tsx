import type { ProfileData } from "@/lib/profile";
import { shortDay } from "./format";

/** Recent XP awards with the reason each was given (spec §4). */
export function XpLog({ rows }: { rows: NonNullable<ProfileData["xp"]>["recentXp"] }) {
  if (rows.length === 0) return <p className="empty">No XP yet. It starts with the first synced minute.</p>;
  return (
    <div>
      {rows.map((r) => (
        <div className="xp-row" key={r.id}>
          <span className="xp-reason">{r.reason}</span>
          <span className="xp-amount num">{r.xp > 0 ? "+" : ""}{r.xp} XP</span>
          <span className="xp-day">{shortDay(r.day)}</span>
        </div>
      ))}
    </div>
  );
}

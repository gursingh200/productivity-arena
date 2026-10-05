"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QuestItem } from "./quest-items";

const KIND_LABEL: Record<string, string> = { live: "Live quest", daily: "Today", weekly: "This week", guild: "Guild, this week" };
const ORDER: Record<string, number> = { live: 0, daily: 1, weekly: 2, guild: 3 };
const GROUP_TITLE: Record<string, string> = { live: "Live", daily: "Today", weekly: "This week", guild: "Your guild this week" };

function amount(value: number, unit: string) {
  if (unit !== "sec") return String(value);
  const m = Math.round(value / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function timeLeft(iso: string | null) {
  if (!iso) return "";
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (min <= 0) return "ending";
  if (min < 60) return `${min}m left`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h left`;
  return `${Math.round(min / 1440)}d left`;
}

export function QuestList({ quests, interactive, grouped = false }: { quests: QuestItem[]; interactive: boolean; grouped?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(id: string, action: "accept" | "decline") {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/agent/quests/${id}/${action}`, { method: "POST" });
    setBusy(null);
    if (!res.ok) setError(res.status === 410 ? "That offer expired. A new one will come along." : "Couldn't update the quest. Try again.");
    router.refresh();
  }

  const offered = quests.filter((q) => q.state === "offered");
  const rest = quests.filter((q) => q.state !== "offered").sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9));
  if (quests.length === 0) return <p className="empty">No quests right now. Daily and weekly quests appear after your Mac’s first sync.</p>;

  const groups = grouped
    ? (["live", "daily", "weekly", "guild"] as const).map((kind) => ({ kind, items: rest.filter((q) => q.kind === kind) })).filter((g) => g.items.length > 0)
    : [{ kind: null, items: rest }];

  return (
    <div>
      {offered.map((q) => (
        <div className="quest-offer" key={q.id}>
          <div className="quest-offer-head">
            <div>
              <div className="quest-title">{q.title}</div>
              <div className="quest-kind">Live quest. Accept within 10 minutes to start.</div>
            </div>
            <span className="quest-xp num">+{q.xp} XP</span>
          </div>
          {interactive ? (
            <div className="quest-offer-actions">
              <button className="btn btn-sm btn-accent" disabled={busy === q.id} onClick={() => respond(q.id, "accept")}>Accept</button>
              <button className="btn btn-sm btn-quiet" disabled={busy === q.id} onClick={() => respond(q.id, "decline")}>Decline</button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="notice notice-err" role="status">{error}</p> : null}
      {groups.map((g) => (
        <div className="quest-group" key={g.kind ?? "all"}>
          {g.kind ? <h3 className="quest-group-title">{GROUP_TITLE[g.kind]}</h3> : null}
          <div className="quests">
            {g.items.map((q) => {
              const done = q.state === "completed";
              const pct = Math.min(100, (q.progress / q.target) * 100);
              return (
                <div className="quest" key={q.id}>
                  <div>
                    <div className="quest-title">{q.title}</div>
                    {g.kind ? null : <div className="quest-kind">{KIND_LABEL[q.kind] ?? q.kind}</div>}
                  </div>
                  <div className="quest-xp num">+{q.xp} XP</div>
                  <div className="meter" aria-hidden><span style={{ width: `${pct}%`, background: done ? "var(--done)" : "var(--xp)" }} /></div>
                  <div className="quest-progress num">
                    {done ? <span className="quest-done"><Check /> Completed</span> : <span>{amount(q.progress, q.unit)} of {amount(q.target, q.unit)}</span>}
                    <span>{done ? "" : timeLeft(q.windowEnd)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 7.5l2.5 2.5L11 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

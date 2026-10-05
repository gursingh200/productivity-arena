"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Week {
  key: "this" | "next";
  label: string;
  days: Array<{ day: string; label: string }>;
  away: string[];
  /** This week can only be changed on its Monday. */
  locked: boolean;
}

export default function AwayForm({ weeks }: { weeks: Week[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, Set<string>>>(
    Object.fromEntries(weeks.map((w) => [w.key, new Set(w.away)])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(week: string, day: string) {
    setPicked((p) => {
      const next = new Set(p[week]);
      if (next.has(day)) next.delete(day); else next.add(day);
      return { ...p, [week]: next };
    });
  }

  function wholeWeek(w: Week) {
    setPicked((p) => ({ ...p, [w.key]: p[w.key]!.size === w.days.length ? new Set() : new Set(w.days.map((d) => d.day)) }));
  }

  async function save(w: Week) {
    setSaving(w.key);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/away", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: w.key, days: [...picked[w.key]!] }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't save. Try again.");
      setMessage({ ok: true, text: `Saved ${w.label.toLowerCase()}.` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't save. Try again." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      {weeks.map((w) => (
        <div className="away-week" key={w.key}>
          <div className="away-head">
            <b>{w.label}</b>
            {w.locked ? <span className="help">Can only be changed on Monday</span> : null}
          </div>
          <div className="away-days">
            {w.days.map((d) => (
              <label key={d.day} className={`chip${picked[w.key]!.has(d.day) ? " on" : ""}`}>
                <input type="checkbox" checked={picked[w.key]!.has(d.day)} disabled={w.locked} onChange={() => toggle(w.key, d.day)} />
                {d.label}
              </label>
            ))}
            <button type="button" className="btn btn-sm btn-quiet" disabled={w.locked} onClick={() => wholeWeek(w)}>
              {picked[w.key]!.size === w.days.length ? "Clear" : "Whole week"}
            </button>
            <button type="button" className="btn btn-sm" disabled={w.locked || saving !== null} onClick={() => save(w)}>
              {saving === w.key ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ))}
      {message ? <p className={`notice${message.ok ? "" : " notice-err"}`} role="status" style={{ marginTop: 14, marginBottom: 0 }}>{message.text}</p> : null}
    </div>
  );
}

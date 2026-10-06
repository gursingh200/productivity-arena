"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  initialName: string;
  initialHandle: string;
  initialBio: string;
  initialTimezone: string;
}

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export default function ProfileForm({ initialName, initialHandle, initialBio, initialTimezone }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [handle, setHandle] = useState(initialHandle);
  const [bio, setBio] = useState(initialBio);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const timezones = COMMON_TIMEZONES.includes(initialTimezone) ? COMMON_TIMEZONES : [initialTimezone, ...COMMON_TIMEZONES];

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, handle, bio, timezone }),
      });
      if (res.status === 409) throw new Error("That handle is taken. Pick another one.");
      if (!res.ok) throw new Error("Couldn't save. Names need 1–100 characters and handles 2–30.");
      setMessage({ type: "ok", text: "Profile saved." });
      router.refresh();
    } catch (err: unknown) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave}>
      <div className="field">
        <label htmlFor="name">Display name</label>
        <input id="name" className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="handle">Handle</label>
        <input id="handle" className="input" value={handle} maxLength={30}
          onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} />
        <span className="help">Your profile lives at /u/{handle || "handle"}. Lowercase letters, numbers and underscores.</span>
      </div>
      <div className="field">
        <label htmlFor="bio">Bio</label>
        <textarea id="bio" className="input textarea" value={bio} maxLength={500} rows={3}
          placeholder="What you're working on" onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="tz">Timezone</label>
        <select id="tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
        <span className="help">Your days and daily quests follow this timezone. Arena on your Mac keeps it in sync with your Mac’s.</span>
      </div>
      {message ? <p className={`notice${message.type === "err" ? " notice-err" : ""}`} role="status">{message.text}</p> : null}
      <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

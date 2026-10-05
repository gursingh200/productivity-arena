"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CATEGORIES, CATEGORY_DETAIL, CATEGORY_LABEL, type Visibility } from "@/lib/sharing";

/** Six sharing toggles. Used by first-login onboarding and by settings. */
export function SharingForm({ initial, submitLabel, redirectTo }: { initial: Visibility; submitLabel: string; redirectTo?: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Visibility>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings/sharing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage({ type: "err", text: "Couldn’t save your sharing choices. Try again." });
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    setMessage({ type: "ok", text: "Sharing saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <div className="share-list">
        {CATEGORIES.map((c) => (
          <label className="share-row" key={c}>
            <span>
              <b>{CATEGORY_LABEL[c]}</b>
              <span className="help">{CATEGORY_DETAIL[c]}</span>
            </span>
            <input type="checkbox" className="switch" checked={choice[c]}
              onChange={(e) => setChoice({ ...choice, [c]: e.target.checked })} aria-label={`Share ${CATEGORY_LABEL[c]}`} />
          </label>
        ))}
      </div>
      {message ? <p className={`notice${message.type === "err" ? " notice-err" : ""}`} role="status">{message.text}</p> : null}
      <button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : submitLabel}</button>
    </form>
  );
}

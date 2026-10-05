"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PLACES = ["Website", "Mac app", "Mac app: Linear", "Mac app: pairing", "Something else"];

export default function BugForm() {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [context, setContext] = useState(PLACES[0]!);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, context }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDescription("");
      setMessage({ ok: true, text: "Report sent. Thanks." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Couldn't send the report. Check that you're still signed in, then try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="bug-place">Where</label>
        <select id="bug-place" className="input" value={context} onChange={(e) => setContext(e.target.value)}>
          {PLACES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="bug-text">What happened?</label>
        <textarea id="bug-text" className="input textarea" rows={6} maxLength={5000} required value={description}
          placeholder="What you did, what you expected, and what happened instead. Paste any error message."
          onChange={(e) => setDescription(e.target.value)} />
      </div>
      <button type="submit" className="btn" disabled={sending || !description.trim()}>{sending ? "Sending…" : "Send report"}</button>
      {message ? <p className={`notice${message.ok ? "" : " notice-err"}`} role="status" style={{ marginTop: 14, marginBottom: 0 }}>{message.text}</p> : null}
    </form>
  );
}

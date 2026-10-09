"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Adds someone who has no guild yet to yours. */
export default function AddMember({ people }: { people: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guild/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't add them. Try again.");
      setUserId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add them. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add}>
      <p className="help" style={{ marginTop: 0 }}>People without a guild. Moving someone out of another guild is for admins.</p>
      <div style={{ display: "flex", gap: 10 }}>
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Person to add" required>
          <option value="" disabled>Choose someone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" type="submit" disabled={busy || !userId}>{busy ? "Adding…" : "Add"}</button>
      </div>
      {error ? <p className="notice notice-err" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p> : null}
    </form>
  );
}

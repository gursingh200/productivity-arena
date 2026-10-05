"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  guilds: Array<{ id: string; name: string; members: number }>;
  people: Array<{ id: string; name: string; guildId: string | null }>;
}

export default function GuildManager({ guilds, people }: Props) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      return true;
    } catch {
      setError("That didn't save. Check that you're still signed in as an admin, then try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (await call("/api/admin/guilds", "POST", { name: newName })) setNewName("");
  }

  function rename(id: string, current: string) {
    const name = window.prompt("Rename guild", current)?.trim();
    if (name && name !== current) void call(`/api/admin/guilds/${id}`, "PATCH", { name });
  }

  function remove(id: string, name: string, members: number) {
    if (window.confirm(`Delete ${name}? ${members ? `Its ${members} member${members === 1 ? "" : "s"} will have no guild. ` : ""}XP already earned stays.`)) {
      void call(`/api/admin/guilds/${id}`, "DELETE");
    }
  }

  return (
    <div className="grid12">
      <section className="panel c5">
        <div className="panel-head"><h2 className="panel-title">Guilds</h2></div>
        {guilds.length === 0 ? <p className="empty" style={{ marginTop: 0 }}>No guilds yet. Create one, then put people in it.</p> : null}
        {guilds.map((g) => (
          <div className="device-row" key={g.id}>
            <div style={{ flex: 1 }}>
              <div className="device-name">{g.name}</div>
              <div className="help">{g.members} member{g.members === 1 ? "" : "s"}</div>
            </div>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => rename(g.id, g.name)}>Rename</button>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => remove(g.id, g.name, g.members)}>Delete</button>
          </div>
        ))}
        <form onSubmit={create} style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <input className="input" placeholder="New guild name" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn" type="submit" disabled={busy || !newName.trim()}>Create</button>
        </form>
        {error ? <p className="notice notice-err" role="alert" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p> : null}
      </section>

      <section className="panel c7">
        <div className="panel-head"><h2 className="panel-title">Members</h2><span className="panel-note">Each person is in one guild at most</span></div>
        {people.map((p) => (
          <div className="device-row" key={p.id}>
            <div style={{ flex: 1 }} className="device-name">{p.name}</div>
            <select className="input" style={{ width: 200 }} aria-label={`Guild for ${p.name}`} disabled={busy || guilds.length === 0}
              value={p.guildId ?? ""} onChange={(e) => void call(`/api/admin/members/${p.id}/guild`, "PUT", { guildId: e.target.value || null })}>
              <option value="">No guild</option>
              {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        ))}
      </section>
    </div>
  );
}

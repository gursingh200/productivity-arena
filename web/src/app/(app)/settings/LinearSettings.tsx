"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  connected: boolean;
  lastSyncedAt: string | null;
}

export default function LinearSettings({ connected, lastSyncedAt }: Props) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isConnected, setIsConnected] = useState(connected);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/linear", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage({ type: "ok", text: "Linear connected. Completed issues now earn XP." });
      setIsConnected(true);
      setApiKey("");
      router.refresh();
    } catch {
      setMessage({ type: "err", text: "Linear didn't accept that key. Copy a fresh personal API key from your Linear account settings and try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Linear? XP you already earned from issues stays.")) return;
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/linear", { method: "DELETE" });
      if (!res.ok) throw new Error("Disconnect failed");
      setIsConnected(false);
      setMessage({ type: "ok", text: "Linear disconnected." });
      router.refresh();
    } catch {
      setMessage({ type: "err", text: "Couldn't disconnect Linear. Try again." });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div>
      {isConnected ? (
        <div className="device-row" style={{ paddingTop: 0 }}>
          <i className="status-dot on" aria-hidden />
          <div style={{ flex: 1 }}>
            <div className="device-name">Connected</div>
            <div className="help">
              {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "First sync pending."} Syncs every 15 minutes.
            </div>
          </div>
          <button className="btn btn-sm btn-quiet" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSave}>
          <div className="field">
            <label htmlFor="linear-key">Personal API key</label>
            <input id="linear-key" className="input" type="password" value={apiKey} placeholder="lin_api_…" required
              onChange={(e) => setApiKey(e.target.value)} />
            <span className="help">Closed issues assigned to you earn XP by estimate. The key is stored encrypted.</span>
          </div>
          <button type="submit" className="btn" disabled={saving || !apiKey.trim()}>{saving ? "Connecting…" : "Connect Linear"}</button>
        </form>
      )}
      {message ? <p className={`notice${message.type === "err" ? " notice-err" : ""}`} role="status" style={{ marginTop: 14, marginBottom: 0 }}>{message.text}</p> : null}
    </div>
  );
}

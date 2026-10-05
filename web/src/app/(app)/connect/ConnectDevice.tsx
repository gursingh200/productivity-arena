"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ConnectResponse {
  deviceId: string;
  token: string;
  pairUrl: string;
}

export default function ConnectDevice() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deviceName, setDeviceName] = useState("My Mac");

  async function handleCreate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: deviceName.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setResult((await res.json()) as ConnectResponse);
      router.refresh();
    } catch {
      setError("Couldn't create a pairing link. Check that you're still signed in, then try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.pairUrl);
    setCopied(true);
  }

  if (result) {
    return (
      <div className="pair">
        <a className="btn" href={result.pairUrl}>Open in Arena</a>
        <p className="help">
          Arena confirms that this Mac is connected. If nothing opens, copy the link and choose
          Connection, then Paste Pairing Link in Arena’s menu. Each link connects one Mac.
        </p>
        <div className="pair-link">
          <code>{result.pairUrl}</code>
          <button className="btn btn-sm btn-quiet" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pair">
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="device-name">Name this Mac</label>
        <input id="device-name" className="input" value={deviceName} maxLength={100}
          onChange={(e) => setDeviceName(e.target.value)} />
      </div>
      <button className="btn" style={{ alignSelf: "flex-start" }} onClick={handleCreate} disabled={loading || !deviceName.trim()}>
        {loading ? "Creating link…" : "Create pairing link"}
      </button>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </div>
  );
}

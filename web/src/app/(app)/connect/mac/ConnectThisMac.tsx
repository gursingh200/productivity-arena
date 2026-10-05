"use client";

import { useState } from "react";

export default function ConnectThisMac({ state, name }: { state: string; name: string }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");

  async function connect() {
    setStatus("working");
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { pairUrl } = (await res.json()) as { pairUrl: string };
      // The Mac only accepts a link carrying the value it sent.
      window.location.href = `${pairUrl}&state=${state}`;
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="pair">
      <button className="btn" onClick={connect} disabled={status === "working" || status === "done"}>
        {status === "working" ? "Connecting…" : status === "done" ? "Opening Arena…" : "Connect this Mac"}
      </button>
      {status === "done" ? <p className="help">Your browser asks to open Arena. Allow it, and Arena confirms the connection. You can close this tab.</p> : null}
      {status === "error" ? <p className="notice notice-err" role="alert">Couldn’t connect. Check that you’re still signed in, then try again.</p> : null}
    </div>
  );
}

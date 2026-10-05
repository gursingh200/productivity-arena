interface Props {
  connected: boolean;
  lastSyncedAt: Date | null;
}

/** Linear is connected from the Mac app, which keeps the key in its Keychain. This only shows the state. */
export default function LinearSettings({ connected, lastSyncedAt }: Props) {
  const synced = lastSyncedAt
    ? `Last synced ${lastSyncedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
    : "First sync pending.";
  return (
    <div className="device-row" style={{ paddingTop: 0 }}>
      <i className={`status-dot${connected ? " on" : ""}`} aria-hidden />
      <div>
        <div className="device-name">{connected ? "Connected" : "Not connected"}</div>
        <p className="help" style={{ margin: 0 }}>
          {connected ? `${synced} Your Mac syncs every 15 minutes. ` : "Closed issues assigned to you earn XP by estimate. "}
          {connected
            ? "To disconnect, choose Connection, then Disconnect Linear in Arena’s menu bar."
            : "In Arena’s menu bar, choose Connection, then Connect Linear, and paste a Linear personal API key."}{" "}
          The key stays in your Mac’s Keychain and is never sent to this site. Only each issue’s number, estimate
          and completion time are.
        </p>
      </div>
    </div>
  );
}

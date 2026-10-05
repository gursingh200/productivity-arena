import Link from "next/link";
import ConnectThisMac from "./ConnectThisMac";

const STATE = /^[0-9a-f]{32}$/;

/** Opened by the Mac app ("Connect to Arena…"): one click links it and sends you back to it. */
export default async function ConnectMacPage({ searchParams }: { searchParams: Promise<{ state?: string; name?: string }> }) {
  const { state, name } = await searchParams;
  const deviceName = (name ?? "").trim().slice(0, 100) || "My Mac";
  return (
    <div style={{ margin: "0 auto", maxWidth: 560 }}>
      <h1 className="page-title">Connect {deviceName}</h1>
      {state && STATE.test(state) ? (
        <>
          <p className="page-sub">Arena on this Mac asked to link to your account. It will send your active, agent and meeting time here.</p>
          <ConnectThisMac state={state} name={deviceName} />
        </>
      ) : (
        <p className="notice">
          This link is incomplete. In Arena’s menu bar choose Connect to Arena… again, or <Link href="/connect">create a pairing link here</Link>.
        </p>
      )}
    </div>
  );
}

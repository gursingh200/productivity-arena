import Link from "next/link";
import type { AppTotal, ProfileData } from "@/lib/profile";
import { NotShared } from "./NotShared";
import { duration, percent } from "./format";

function label(app: AppTotal) {
  return app.id === "private" ? "Private apps" : app.id === "unknown" ? "Other" : app.name ?? app.id;
}
function initial(app: AppTotal) {
  return app.id === "private" ? "•" : label(app).slice(0, 1).toUpperCase();
}

function AppRows({ apps, tone, show }: { apps: AppTotal[]; tone: "human" | "meeting"; show: "pct" | "time" }) {
  const top = Math.max(1, ...apps.map((a) => a.pct));
  return (
    <div className="rows">
      {apps.map((app) => (
        <div className="row" key={app.id}>
          <div className="row-main">
            <span className="app-icon" aria-hidden>{initial(app)}</span>
            <span className="row-name">{label(app)}</span>
          </div>
          <span className="row-value num">{show === "pct" ? percent(app.pct) : duration(app.sec)}</span>
          <div className="meter" aria-hidden><span style={{ width: `${Math.max(2, (app.pct / top) * 100)}%`, background: `var(--${tone})`, color: `var(--${tone})` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Where human time went (top apps) and which apps the calls happened in, last 30 days. */
export function AppsPanel({ data }: { data: ProfileData }) {
  const { apps, isOwner } = data;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Apps</h2>
        <span className="panel-note">Last 30 days</span>
      </div>
      {apps === null ? (
        <NotShared category="apps" reason={data.hidden.apps} name={data.user.name} />
      ) : apps.top.length === 0 ? (
        <p className="empty">
          No app time yet.{isOwner ? <> <Link href="/connect">Connect your Mac</Link> to start tracking.</> : null}
        </p>
      ) : (
        <AppRows apps={apps.top.slice(0, 6)} tone="human" show="pct" />
      )}
      {apps?.calls && apps.calls.length > 0 ? (
        <>
          <h3 className="subhead">Calls</h3>
          <AppRows apps={apps.calls} tone="meeting" show="time" />
        </>
      ) : null}
    </div>
  );
}

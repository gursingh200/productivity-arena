import { CHANGELOG } from "@/lib/changelog";

function longDate(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function ChangelogPage() {
  return (
    <div style={{ margin: "0 auto", maxWidth: 720 }}>
      <h1 className="page-title">What’s new</h1>
      <p className="page-sub">Everything that changed in Arena, newest first. The Mac app updates itself.</p>
      {CHANGELOG.map((r) => (
        <section className="release" key={r.date + r.title}>
          <div className="release-when">
            <time dateTime={r.date}>{longDate(r.date)}</time>
            {r.mac ? <span className="help">Mac {r.mac}</span> : null}
          </div>
          <div className="panel">
            <h2 className="panel-title" style={{ marginBottom: 12 }}>{r.title}</h2>
            <ul className="release-list">
              {r.changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

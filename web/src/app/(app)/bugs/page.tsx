import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bugReports, users } from "@/db/schema";
import { requireViewer } from "@/lib/viewer";
import BugForm from "./BugForm";
import { isAdmin } from "@/lib/roles";

function when(d: Date) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Anyone can report a bug and see their own reports; admins see everyone's. */
export default async function BugsPage() {
  const viewer = await requireViewer();
  const admin = isAdmin(viewer);
  const reports = await db.select({
    id: bugReports.id, description: bugReports.description, context: bugReports.context,
    userAgent: bugReports.userAgent, createdAt: bugReports.createdAt, name: users.name, email: users.email,
  }).from(bugReports).innerJoin(users, eq(users.id, bugReports.userId))
    .where(admin ? undefined : eq(bugReports.userId, viewer.id))
    .orderBy(desc(bugReports.createdAt)).limit(200);

  return (
    <div style={{ margin: "0 auto", maxWidth: 760 }}>
      <h1 className="page-title">Report a bug</h1>
      <p className="page-sub">Tell us what went wrong. Admins see every report{admin ? ", which is why you see everyone’s below" : ""}.</p>

      <section className="panel"><BugForm /></section>

      <h2 className="section-label">{admin ? "All reports" : "Your reports"}</h2>
      <section className="panel">
        {reports.length === 0 ? <p className="empty" style={{ margin: 0 }}>No reports yet.</p> : null}
        {reports.map((r) => (
          <div className="xp-row" key={r.id}>
            <span className="xp-reason" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.description}</span>
            <span className="xp-day">{when(r.createdAt)}</span>
            <span className="help">
              {r.context ?? "No place given"}{admin ? `, from ${r.name ?? r.email}` : ""}
              {admin && r.userAgent ? <><br />{r.userAgent}</> : null}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

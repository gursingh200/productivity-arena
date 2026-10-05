import type { ProfileData } from "@/lib/profile";
import { NotShared } from "./NotShared";
import { agentName, compact, duration, hours } from "./format";

/** Agent-hours, output tokens and chats per coding agent, last 30 days. */
export function AgentsPanel({ data }: { data: ProfileData }) {
  const last30 = data.agents;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Agents</h2>
        <span className="panel-note">Last 30 days</span>
      </div>
      {last30 === null ? (
        <NotShared category="agents" reason={data.hidden.agents} name={data.user.name} />
      ) : last30.agents.length === 0 ? (
        <p className="empty">No agent time yet. It appears once the Mac app sees Claude Code, Codex, OpenCode, Pi or Cursor at work.</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr><th>Agent</th><th className="r">Agent-hours</th><th className="r">Output tokens</th><th className="r">Chats</th></tr>
            </thead>
            <tbody>
              {last30.agents.map((a) => (
                <tr key={a.agent}>
                  <td><span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><i className="dot dot-agent" />{agentName(a.agent)}</span></td>
                  <td className="r num">{hours(a.agentSec)}</td>
                  <td className="r num">{a.tokensOut > 0 ? compact(a.tokensOut) : "–"}</td>
                  <td className="r num">{a.chats > 0 ? a.chats : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="facts">
            <div className="fact"><div className="fact-label">Most at once</div><div className="fact-value num">{last30.peakParallel} {last30.peakParallel === 1 ? "agent" : "agents"}</div></div>
            <div className="fact"><div className="fact-label">Output per chat</div><div className="fact-value num">{compact(last30.chats.avgTokensOut)} tokens</div></div>
            <div className="fact"><div className="fact-label">Longest chat</div><div className="fact-value num">{last30.chats.longest ? duration(last30.chats.longest.agentSec) : "–"}</div></div>
          </div>
        </>
      )}
    </div>
  );
}

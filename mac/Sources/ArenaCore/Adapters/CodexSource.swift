import Foundation

/// Codex CLI (also what T3 Code drives): `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
/// Lines are `{timestamp, type, payload}`.
///
/// - Human: `event_msg` `task_started` (a turn begins) or `user_message`.
/// - Agent: model output and tool activity — every `response_item` except
///   user/developer/system messages (those are injected context), and
///   `event_msg` `token_count`, `agent_message`, `item_completed`,
///   `task_complete`, `turn_aborted`.
/// - Tokens: `token_count.info.last_token_usage`, keyed by the cumulative
///   `total_token_usage.total_tokens` so repeated token_count events for the
///   same usage collapse into one row.
public struct CodexSource: JSONLAgentSource {
    public let agent = "codex"
    public let requireTokens = true

    public init() {}

    static let agentEventTypes: Set<String> = [
        "token_count", "agent_message", "item_completed", "task_complete", "turn_aborted",
    ]
    static let injectedRoles: Set<String> = ["user", "developer", "system"]

    public func roots(_ paths: AgentPaths) -> [String] {
        var roots: [String] = []
        if let dir = paths.environment["CODEX_HOME"], !dir.isEmpty {
            roots.append((dir as NSString).appendingPathComponent("sessions"))
        }
        roots.append(paths.join(".codex", "sessions"))
        return uniqueExisting(roots)
    }

    public func isSessionFile(_ path: String) -> Bool {
        let name = (path as NSString).lastPathComponent
        return name.hasPrefix("rollout-") && name.hasSuffix(".jsonl")
    }

    /// The session uuid is the last 36 characters of the file stem.
    public func sessionId(forFile path: String) -> String {
        let stem = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
        return stem.count > 36 ? String(stem.suffix(36)) : stem
    }

    public func events(fromLine line: Data) -> [AgentEvent] {
        guard let obj = jsonObject(line),
              let type = obj["type"] as? String,
              let tsString = obj["timestamp"] as? String,
              let ts = parseISO(tsString),
              let payload = obj["payload"] as? [String: Any] else { return [] }
        let payloadType = payload["type"] as? String ?? ""

        switch type {
        case "event_msg":
            if payloadType == "task_started" || payloadType == "user_message" {
                return [AgentEvent(timestamp: ts, kind: .human)]
            }
            if payloadType == "token_count" {
                return [tokenEvent(payload: payload, at: ts)]
            }
            return Self.agentEventTypes.contains(payloadType) ? [AgentEvent(timestamp: ts, kind: .agent)] : []
        case "response_item":
            if payloadType == "message", let role = payload["role"] as? String, Self.injectedRoles.contains(role) {
                return []
            }
            return [AgentEvent(timestamp: ts, kind: .agent)]
        default:
            return []
        }
    }

    private func tokenEvent(payload: [String: Any], at ts: Date) -> AgentEvent {
        var event = AgentEvent(timestamp: ts, kind: .agent)
        guard let info = payload["info"] as? [String: Any],
              let last = info["last_token_usage"] as? [String: Any] else { return event }
        let input = int64(last["input_tokens"])
        let cached = int64(last["cached_input_tokens"])
        let cacheWrite = int64(last["cache_write_input_tokens"])
        event.tokens = TokenUsage(input: max(0, input - cached) + cacheWrite, cached: cached,
                                  output: int64(last["output_tokens"]))
        let total = (info["total_token_usage"] as? [String: Any]).map { int64($0["total_tokens"]) }
        event.tokenKey = "total:\(total ?? int64(last["total_tokens"]))"
        return event
    }
}

import Foundation

/// Claude Code: `~/.claude/projects/<project>/<session>.jsonl`, plus
/// `<session>/subagents/*.jsonl` for sub-agents. A sub-agent belongs to its
/// parent's session: their events form one timeline, so overlapping time
/// counts once, the whole thing is one parallel session and one chat.
///
/// - Human: `type:"user"` that is not a tool result, not `isMeta`, not a
///   sub-agent prompt (`isSidechain`), and whose `origin.kind` is "human" or
///   absent (older logs).
/// - Agent: `type:"assistant"`, tool results, and agent wake-ups
///   (`origin.kind` "task-notification" or "peer").
/// - Everything else (titles, modes, attachments, snapshots…) is ignored.
/// - Tokens: `message.usage`, keyed by `message.id` so streamed lines that
///   repeat a message replace each other instead of adding up.
public struct ClaudeSource: JSONLAgentSource {
    public let agent = "claude"
    public let requireTokens = true

    public init() {}

    public func roots(_ paths: AgentPaths) -> [String] {
        var roots: [String] = []
        if let dir = paths.environment["CLAUDE_CONFIG_DIR"], !dir.isEmpty {
            roots.append((dir as NSString).appendingPathComponent("projects"))
        }
        if let xdg = paths.environment["XDG_CONFIG_HOME"], !xdg.isEmpty {
            roots.append((xdg as NSString).appendingPathComponent("claude/projects"))
        }
        roots.append(paths.join(".config", "claude", "projects"))
        roots.append(paths.join(".claude", "projects"))
        return uniqueExisting(roots)
    }

    public func isSessionFile(_ path: String) -> Bool {
        path.hasSuffix(".jsonl")
    }

    public func sessionId(forFile path: String) -> String {
        let url = URL(fileURLWithPath: path)
        let stem = url.deletingPathExtension().lastPathComponent
        let parent = url.deletingLastPathComponent()
        if parent.lastPathComponent == "subagents" {
            return parent.deletingLastPathComponent().lastPathComponent
        }
        return stem
    }

    public func events(fromLine line: Data) -> [AgentEvent] {
        guard let obj = jsonObject(line),
              let type = obj["type"] as? String,
              let tsString = obj["timestamp"] as? String,
              let ts = parseISO(tsString) else { return [] }

        switch type {
        case "assistant":
            let message = obj["message"] as? [String: Any] ?? [:]
            var event = AgentEvent(timestamp: ts, kind: .agent)
            if let usage = message["usage"] as? [String: Any] {
                event.tokens = TokenUsage(
                    input: int64(usage["input_tokens"]) + int64(usage["cache_creation_input_tokens"]),
                    cached: int64(usage["cache_read_input_tokens"]),
                    output: int64(usage["output_tokens"]))
                event.tokenKey = (message["id"] as? String) ?? (obj["requestId"] as? String) ?? (obj["uuid"] as? String)
            }
            return [event]
        case "user":
            if obj["toolUseResult"] != nil || containsToolResult(obj["message"]) {
                return [AgentEvent(timestamp: ts, kind: .agent)]
            }
            if (obj["isMeta"] as? Bool) == true { return [] }
            // In a sub-agent log the "user" is the parent agent handing over its task.
            if (obj["isSidechain"] as? Bool) == true { return [AgentEvent(timestamp: ts, kind: .agent)] }
            let originKind = (obj["origin"] as? [String: Any])?["kind"] as? String
            switch originKind {
            case nil, "human": return [AgentEvent(timestamp: ts, kind: .human)]
            case "task-notification", "peer": return [AgentEvent(timestamp: ts, kind: .agent)]
            default: return []
            }
        default:
            return []
        }
    }

    private func containsToolResult(_ message: Any?) -> Bool {
        guard let content = (message as? [String: Any])?["content"] as? [[String: Any]] else { return false }
        return content.contains { ($0["type"] as? String) == "tool_result" }
    }
}

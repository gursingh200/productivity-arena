import Foundation

/// Pi coding agent: `~/.pi/agent/sessions/**/*.jsonl` (or `$PI_CODING_AGENT_DIR/sessions`).
///
/// - Human: `type:"message"` with `message.role == "user"`.
/// - Agent: `message.role` "assistant" or "toolResult".
/// - Tokens: assistant `message.usage{input, output, cacheRead, cacheWrite}`,
///   keyed by the line `id` (or its timestamp when there is no id).
public struct PiSource: JSONLAgentSource {
    public let agent = "pi"
    public let requireTokens = true

    public init() {}

    public func roots(_ paths: AgentPaths) -> [String] {
        var roots: [String] = []
        if let dir = paths.environment["PI_CODING_AGENT_DIR"], !dir.isEmpty {
            roots.append((dir as NSString).appendingPathComponent("sessions"))
        }
        roots.append(paths.join(".pi", "agent", "sessions"))
        return uniqueExisting(roots)
    }

    public func isSessionFile(_ path: String) -> Bool {
        path.hasSuffix(".jsonl")
    }

    public func sessionId(forFile path: String) -> String {
        URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    }

    public func events(fromLine line: Data) -> [AgentEvent] {
        guard let obj = jsonObject(line),
              (obj["type"] as? String) == "message",
              let tsString = obj["timestamp"] as? String,
              let ts = parseISO(tsString),
              let message = obj["message"] as? [String: Any],
              let role = message["role"] as? String else { return [] }

        switch role {
        case "user":
            return [AgentEvent(timestamp: ts, kind: .human)]
        case "assistant":
            var event = AgentEvent(timestamp: ts, kind: .agent)
            if let usage = message["usage"] as? [String: Any] {
                event.tokens = TokenUsage(input: int64(usage["input"]) + int64(usage["cacheWrite"]),
                                          cached: int64(usage["cacheRead"]),
                                          output: int64(usage["output"]))
                event.tokenKey = (obj["id"] as? String) ?? tsString
            }
            return [event]
        case "toolResult":
            return [AgentEvent(timestamp: ts, kind: .agent)]
        default:
            return []
        }
    }
}

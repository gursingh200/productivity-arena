import Foundation
import SQLite3

/// OpenCode: SQLite at `~/.local/share/opencode/opencode.db`, table
/// `message(id, session_id, time_created, time_updated, data)`.
///
/// - Human: `data.role == "user"` at `time.created`.
/// - Agent: assistant messages emit events at `time.created` and
///   `time.completed`, so each reply's exact duration counts.
/// - Tokens: `data.tokens{input, output, reasoning, cache{read, write}}`, keyed by message id.
///
/// Reads only rows with `time_updated > watermark` (ms), oldest first.
public struct OpenCodeSource: Sendable {
    public let agent = "opencode"
    public let requireTokens = true

    public init() {}

    public func databasePath(_ paths: AgentPaths) -> String {
        if let xdg = paths.environment["XDG_DATA_HOME"], !xdg.isEmpty {
            return (xdg as NSString).appendingPathComponent("opencode/opencode.db")
        }
        return paths.join(".local", "share", "opencode", "opencode.db")
    }

    public struct Batch {
        public var sessions: SessionEvents
        public var newWatermark: Int64
    }

    public func read(databasePath: String, watermark: Int64, limit: Int = 5000) -> Batch? {
        var sessions: SessionEvents = [:]
        var newWatermark = watermark
        let ok = ReadOnlyDatabase.eachRow(
            path: databasePath,
            sql: "SELECT id, session_id, time_updated, data FROM message WHERE time_updated > ? ORDER BY time_updated LIMIT ?;",
            bind: [watermark, Int64(limit)]
        ) { stmt in
            guard let id = ReadOnlyDatabase.text(stmt, 0),
                  let session = ReadOnlyDatabase.text(stmt, 1),
                  let json = ReadOnlyDatabase.text(stmt, 3) else { return }
            newWatermark = max(newWatermark, sqlite3_column_int64(stmt, 2))
            sessions[session, default: []].append(contentsOf: events(messageId: id, json: Data(json.utf8)))
        }
        return ok ? Batch(sessions: sessions, newWatermark: newWatermark) : nil
    }

    func events(messageId: String, json: Data) -> [AgentEvent] {
        guard let data = jsonObject(json), let role = data["role"] as? String,
              let time = data["time"] as? [String: Any] else { return [] }
        let created = int64(time["created"])
        guard created > 0 else { return [] }
        let createdAt = dateOfMs(created)

        switch role {
        case "user":
            return [AgentEvent(timestamp: createdAt, kind: .human)]
        case "assistant":
            var start = AgentEvent(timestamp: createdAt, kind: .agent)
            if let tokens = data["tokens"] as? [String: Any] {
                let cache = tokens["cache"] as? [String: Any] ?? [:]
                start.tokens = TokenUsage(input: int64(tokens["input"]) + int64(cache["write"]),
                                          cached: int64(cache["read"]),
                                          output: int64(tokens["output"]) + int64(tokens["reasoning"]))
                start.tokenKey = messageId
            }
            let completed = int64(time["completed"])
            guard completed > created else { return [start] }
            return [start, AgentEvent(timestamp: dateOfMs(completed), kind: .agent)]
        default:
            return []
        }
    }
}

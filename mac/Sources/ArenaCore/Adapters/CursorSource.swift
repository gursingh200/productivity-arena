import Foundation

/// Cursor editor: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`,
/// table `cursorDiskKV`, keys `bubbleId:<composerId>:<bubbleId>`.
///
/// - Session = composer (chat) id.
/// - Human: bubble `type == 1`; Agent: bubble `type == 2`, at `createdAt`.
/// - Cursor's local DB records zero tokens for most bubbles, so Cursor is
///   exempt from the token evidence rule; tokens are still recorded when present.
///
/// The whole table is rescanned (only the JSON fields we need) for bubbles
/// newer than `since`; events are idempotent so rescans don't double count.
public struct CursorSource: Sendable {
    public let agent = "cursor"
    public let requireTokens = false

    public init() {}

    public func databasePath(_ paths: AgentPaths) -> String {
        paths.join("Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
    }

    public func read(databasePath: String, since: Date) -> SessionEvents? {
        var sessions: SessionEvents = [:]
        let sinceISO = ISO8601DateFormatter().string(from: since)
        let sql = """
            SELECT key, json_extract(value, '$.type'), json_extract(value, '$.createdAt'),
                   json_extract(value, '$.tokenCount.inputTokens'), json_extract(value, '$.tokenCount.outputTokens')
            FROM cursorDiskKV
            WHERE key LIKE 'bubbleId:%' AND json_valid(value) AND json_extract(value, '$.createdAt') >= '\(sinceISO)';
            """
        let ok = ReadOnlyDatabase.eachRow(path: databasePath, sql: sql) { stmt in
            guard let key = ReadOnlyDatabase.text(stmt, 0),
                  let created = ReadOnlyDatabase.text(stmt, 2).flatMap(parseISO) else { return }
            let parts = key.split(separator: ":")
            guard parts.count >= 3 else { return }
            let type = int64(ReadOnlyDatabase.text(stmt, 1))
            var event = AgentEvent(timestamp: created, kind: type == 1 ? .human : .agent)
            let input = int64(ReadOnlyDatabase.text(stmt, 3))
            let output = int64(ReadOnlyDatabase.text(stmt, 4))
            if input > 0 || output > 0 {
                event.tokens = TokenUsage(input: input, cached: 0, output: output)
                event.tokenKey = String(parts[2])
            }
            sessions[String(parts[1]), default: []].append(event)
        }
        return ok ? sessions : nil
    }
}

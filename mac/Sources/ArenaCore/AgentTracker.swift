import Foundation

/// Turns agent logs into stored events, tokens and per-session working
/// minutes. All methods must be called on one serial queue.
public final class AgentTracker {

    /// Only the last 7 days of agent activity are read (first run backfill and
    /// any late-arriving old lines).
    public static let lookback: TimeInterval = 7 * 86_400

    private let store: Store
    private let paths: AgentPaths
    private let now: () -> Date

    public init(store: Store, paths: AgentPaths = AgentPaths(), now: @escaping () -> Date = Date.init) {
        self.store = store
        self.paths = paths
        self.now = now
    }

    // MARK: - Ingest

    /// Stores new events for a session and recomputes its working minutes from
    /// the start of the earliest affected turn.
    public func ingest(agent: String, session: String, events: [AgentEvent], requireTokens: Bool) throws {
        let cutoff = now().addingTimeInterval(-Self.lookback)
        let fresh = events.filter { $0.timestamp >= cutoff }
        guard let earliest = fresh.map(\.timestamp).min() else { return }

        try store.transaction {
            try store.insertEvents(agent: agent, session: session, events: fresh)
            let tokenMinutes = try store.upsertTokens(agent: agent, session: session, events: fresh)

            // Recompute from the minute of the turn that contains the earliest new event.
            let anchor = try store.lastHumanEvent(agent: agent, session: session, atOrBefore: earliest)
                ?? store.firstEvent(agent: agent, session: session) ?? earliest
            let fromMinute = minuteOf(anchor)
            let clipFrom = dateOfMinute(fromMinute)

            // Load enough history that pairs crossing into `fromMinute` and their
            // turns' token evidence are complete: back to a human event at least
            // one max gap before it.
            let loadFrom = try store.lastHumanEvent(agent: agent, session: session,
                                                    atOrBefore: clipFrom.addingTimeInterval(-SessionTimeline.maxGap))
                ?? .distantPast
            let sessionEvents = try store.events(agent: agent, session: session, from: loadFrom)
            let tokens = try store.tokenRecords(agent: agent, session: session, from: loadFrom)
            let result = SessionTimeline.compute(events: sessionEvents, tokens: tokens,
                                                 requireTokens: requireTokens, clipFrom: clipFrom)

            let previous = try store.sessionMinutes(agent: agent, session: session, from: fromMinute)
            try store.replaceSessionMinutes(agent: agent, session: session, from: fromMinute,
                                            rows: result.secondsByMinute)

            let changed = Set(previous.keys).union(result.secondsByMinute.keys).union(tokenMinutes)
            for t in changed { try store.markMinuteDirty(t) }
            try store.markChatDirty(agent: agent, session: session)
        }
    }

    /// Recomputes a whole session's working minutes from its stored events.
    public func recomputeSession(agent: String, session: String, requireTokens: Bool) throws {
        try store.transaction {
            guard let first = try store.firstEvent(agent: agent, session: session) else { return }
            let fromMinute = minuteOf(first)
            let events = try store.events(agent: agent, session: session, from: .distantPast)
            let tokens = try store.tokenRecords(agent: agent, session: session, from: .distantPast)
            let result = SessionTimeline.compute(events: events, tokens: tokens, requireTokens: requireTokens)
            let previous = try store.sessionMinutes(agent: agent, session: session, from: fromMinute)
            try store.replaceSessionMinutes(agent: agent, session: session, from: fromMinute, rows: result.secondsByMinute)
            for t in Set(previous.keys).union(result.secondsByMinute.keys) { try store.markMinuteDirty(t) }
            try store.markChatDirty(agent: agent, session: session)
        }
    }

    static let subagentMergeKey = "schema.subagents"

    /// One-time migration: version 1 stored each Claude sub-agent as its own
    /// `<parent>/<stem>` session. Moves their events into the parent, recomputes
    /// the parents, and queues the old sub-agent chat ids for deletion on the server.
    public func mergeClaudeSubagents() throws {
        guard try store.value(Self.subagentMergeKey) == nil else { return }
        let source = ClaudeSource()
        // The parents still to recompute are saved with the merge itself, so a
        // crash before the recompute finishes resumes it on the next launch.
        try store.transaction {
            var parents = Set(try pendingParents())
            for session in try store.claudeSubagentSessions() {
                guard let slash = session.firstIndex(of: "/") else { continue }
                let parent = String(session[..<slash])
                _ = try store.mergeSession(agent: source.agent, session: session, into: parent)
                try store.addDeletedChat(chatId(agent: source.agent, sessionId: session))
                parents.insert(parent)
            }
            try store.setValue(parents.sorted().joined(separator: "\n"), for: Self.subagentPendingKey)
        }
        for parent in try pendingParents() {
            try recomputeSession(agent: source.agent, session: parent, requireTokens: source.requireTokens)
        }
        try store.transaction {
            try store.setValue(nil, for: Self.subagentPendingKey)
            try store.setValue("2", for: Self.subagentMergeKey)
        }
    }

    static let subagentPendingKey = "schema.subagents.pending"

    private func pendingParents() throws -> [String] {
        (try store.value(Self.subagentPendingKey) ?? "").split(separator: "\n").map(String.init)
    }

    // MARK: - Log files

    /// Reads everything new in one session log file.
    public func processFile(_ path: String, source: any JSONLAgentSource) throws {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              let inode = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value,
              let size = (attributes[.size] as? NSNumber)?.int64Value else { return }
        let modified = attributes[.modificationDate] as? Date ?? .distantPast

        let saved = try store.fileCursor(path: path)
        var cursor: Store.FileCursor
        if let saved, saved.inode == inode, saved.offset <= size {
            cursor = saved
        } else if saved == nil, modified < now().addingTimeInterval(-Self.lookback) {
            // Untouched for longer than the lookback: nothing to backfill.
            try store.saveFileCursor(path: path, cursor: Store.FileCursor(inode: inode, offset: size))
            return
        } else {
            // New, rotated or truncated file: read from the start.
            cursor = Store.FileCursor(inode: inode, offset: 0)
        }

        let session = source.sessionId(forFile: path)
        while true {
            // Parsing creates many temporary Foundation objects; release them per chunk.
            let (chunk, events) = try autoreleasepool {
                let chunk = try LineReader.read(path: path, from: cursor.offset)
                return (chunk, chunk.lines.flatMap { source.events(fromLine: $0) })
            }
            try ingest(agent: source.agent, session: session, events: events, requireTokens: source.requireTokens)
            let madeProgress = chunk.newOffset > cursor.offset
            cursor.offset = chunk.newOffset
            try store.saveFileCursor(path: path, cursor: cursor)
            if chunk.reachedEnd || !madeProgress { break }
        }
    }

    /// Every session file currently under a source's roots.
    public func sessionFiles(for source: any JSONLAgentSource) -> [String] {
        var files: [String] = []
        for root in source.roots(paths) {
            guard let enumerator = FileManager.default.enumerator(atPath: root) else { continue }
            while let relative = enumerator.nextObject() as? String {
                let full = (root as NSString).appendingPathComponent(relative)
                if source.isSessionFile(full) { files.append(full) }
            }
        }
        return files
    }

    /// Which source owns a changed path, if any.
    public func source(forFile path: String) -> (any JSONLAgentSource)? {
        jsonlAgentSources.first { source in
            source.isSessionFile(path) && source.roots(paths).contains { path.hasPrefix($0 + "/") }
        }
    }

    // MARK: - Databases

    public func scanOpenCode(source: OpenCodeSource = OpenCodeSource()) throws {
        let path = source.databasePath(paths)
        guard FileManager.default.fileExists(atPath: path) else { return }
        let key = "watermark.opencode"
        let defaultWatermark = ms(now().addingTimeInterval(-Self.lookback))
        var watermark = Int64(try store.value(key) ?? "") ?? defaultWatermark
        while let batch = source.read(databasePath: path, watermark: watermark) {
            for (session, events) in batch.sessions {
                try ingest(agent: source.agent, session: session, events: events, requireTokens: source.requireTokens)
            }
            guard batch.newWatermark > watermark else { break }
            watermark = batch.newWatermark
            try store.setValue(String(watermark), for: key)
        }
    }

    public func scanCursor(source: CursorSource = CursorSource()) throws {
        let path = source.databasePath(paths)
        guard let sessions = source.read(databasePath: path, since: now().addingTimeInterval(-Self.lookback)) else { return }
        for (session, events) in sessions {
            try ingest(agent: source.agent, session: session, events: events, requireTokens: source.requireTokens)
        }
    }

    public func databasePaths() -> [String] {
        [OpenCodeSource().databasePath(paths), CursorSource().databasePath(paths)]
    }

    // MARK: - Process fallback

    /// Credits each busy agent with a full working minute.
    public func recordBusyProcesses(_ agents: Set<String>, minute: MinuteT) throws {
        for agent in agents {
            try store.setSessionMinute(agent: agent, session: "process", t: minute, sec: 60)
        }
    }
}

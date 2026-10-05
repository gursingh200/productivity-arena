import Foundation
import SQLite3

/// SQLITE_TRANSIENT: SQLite copies bound strings immediately.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Local SQLite store, by default at ~/Library/Application Support/Arena/arena.db.
///
/// Agent data is kept as raw events + token rows per session. Working seconds
/// per (session, minute) are derived from them by `AgentTracker` and stored in
/// `session_minute`; the per-minute agent rows and chat rollups sent to the
/// server are aggregated from these tables at upload time.
///
/// Not thread-safe by design: callers serialize access (see `ArenaEngine`).
public final class Store {

    public let path: String
    private var db: OpaquePointer?

    public init(path: String) throws {
        self.path = path
        try open()
        try createSchema()
    }

    deinit {
        sqlite3_close(db)
    }

    /// ~/Library/Application Support/Arena/arena.db. A build with a different
    /// bundle id (a self-hosted org's own build) keeps its data separately in
    /// "Arena-<bundle id>", so two Arena builds on one Mac never share a store.
    public static func defaultPath(bundleId: String? = Bundle.main.bundleIdentifier) -> String {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = (bundleId == nil || bundleId == "io.clueso.arena") ? "Arena" : "Arena-\(bundleId!)"
        return support.appendingPathComponent(folder).appendingPathComponent("arena.db").path
    }

    // MARK: - Setup

    private func open() throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
            throw StoreError.cannotOpen(path)
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        try execute("PRAGMA journal_mode=WAL;")
        try execute("PRAGMA synchronous=NORMAL;")
    }

    private func createSchema() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS app_minute(
            t INTEGER NOT NULL, bundle_id TEXT NOT NULL, app_name TEXT NOT NULL, sec INTEGER NOT NULL,
            PRIMARY KEY(t, bundle_id)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS title_minute(
            t INTEGER NOT NULL, bundle_id TEXT NOT NULL, title TEXT NOT NULL, sec INTEGER NOT NULL,
            PRIMARY KEY(t, bundle_id, title)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS agent_event(
            agent TEXT NOT NULL, session TEXT NOT NULL, ts_ms INTEGER NOT NULL, kind INTEGER NOT NULL,
            PRIMARY KEY(agent, session, ts_ms, kind)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS agent_tokens(
            agent TEXT NOT NULL, session TEXT NOT NULL, token_key TEXT NOT NULL, ts_ms INTEGER NOT NULL,
            tokens_in INTEGER NOT NULL, tokens_cached INTEGER NOT NULL, tokens_out INTEGER NOT NULL,
            PRIMARY KEY(agent, session, token_key)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS agent_tokens_ts ON agent_tokens(ts_ms);
        CREATE TABLE IF NOT EXISTS session_minute(
            agent TEXT NOT NULL, session TEXT NOT NULL, t INTEGER NOT NULL, sec REAL NOT NULL,
            PRIMARY KEY(agent, session, t)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS session_minute_t ON session_minute(t);
        CREATE TABLE IF NOT EXISTS dirty_minute(t INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS dirty_chat(
            agent TEXT NOT NULL, session TEXT NOT NULL, PRIMARY KEY(agent, session)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS file_cursor(
            path TEXT PRIMARY KEY, inode INTEGER NOT NULL, offset INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS active_minute(t INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS meeting_minute(
            t INTEGER NOT NULL, bundle_id TEXT NOT NULL, app_name TEXT NOT NULL, sec INTEGER NOT NULL,
            PRIMARY KEY(t, bundle_id)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS deleted_chat(chat_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS chat_base(
            agent TEXT NOT NULL, session TEXT NOT NULL, first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL,
            turns INTEGER NOT NULL, tokens_in INTEGER NOT NULL, tokens_cached INTEGER NOT NULL, tokens_out INTEGER NOT NULL,
            PRIMARY KEY(agent, session)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS active_minute_t ON active_minute(t);
        """)
        try migrateActiveMinutes()
    }

    /// Version 2 counts human time as whole active minutes. Minutes recorded by
    /// version 1 had input-driven app seconds, so each of them is active.
    private func migrateActiveMinutes() throws {
        guard try value(Self.humanSchemaKey) == nil else { return }
        try transaction {
            try run("INSERT OR IGNORE INTO active_minute(t) SELECT DISTINCT t FROM app_minute;")
            try setValue("2", for: Self.humanSchemaKey)
        }
    }

    static let humanSchemaKey = "schema.human"

    // MARK: - Transactions

    public func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE;")
        do {
            let result = try body()
            try execute("COMMIT;")
            return result
        } catch {
            try? execute("ROLLBACK;")
            throw error
        }
    }

    // MARK: - Human activity

    /// Adds active seconds for an app in a minute and marks the minute dirty.
    public func addAppSeconds(t: MinuteT, bundleId: String, appName: String, sec: Int) throws {
        try run("""
            INSERT INTO app_minute(t, bundle_id, app_name, sec) VALUES(?,?,?,?)
            ON CONFLICT(t, bundle_id) DO UPDATE SET sec = sec + excluded.sec, app_name = excluded.app_name;
            """, [.int(t), .text(bundleId), .text(appName), .int(Int64(sec))])
        try markMinuteDirty(t)
    }

    public struct AppSeconds: Equatable {
        public var bundleId: String
        public var appName: String
        public var sec: Int
    }

    public func appSeconds(t: MinuteT) throws -> [AppSeconds] {
        try query("SELECT bundle_id, app_name, sec FROM app_minute WHERE t = ? ORDER BY sec DESC;", [.int(t)]) {
            AppSeconds(bundleId: $0.text(0), appName: $0.text(1), sec: Int($0.int(2)))
        }
    }

    /// Total seconds per app between two minutes (inclusive), largest first.
    public func appTotals(from: MinuteT, to: MinuteT) throws -> [AppSeconds] {
        try query("""
            SELECT bundle_id, MAX(app_name), SUM(sec) FROM app_minute WHERE t BETWEEN ? AND ?
            GROUP BY bundle_id ORDER BY SUM(sec) DESC;
            """, [.int(from), .int(to)]) {
            AppSeconds(bundleId: $0.text(0), appName: $0.text(1), sec: Int($0.int(2)))
        }
    }

    /// Marks a minute as one with human input. Returns true (and marks the
    /// minute dirty) only the first time, so repeated ticks don't re-send it.
    @discardableResult
    public func markActive(_ t: MinuteT) throws -> Bool {
        guard try runCountingChanges("INSERT OR IGNORE INTO active_minute(t) VALUES(?);", [.int(t)]) > 0 else { return false }
        try markMinuteDirty(t)
        return true
    }

    public func isActive(_ t: MinuteT) throws -> Bool {
        try query("SELECT 1 FROM active_minute WHERE t = ?;", [.int(t)]) { _ in true }.first ?? false
    }

    /// Active minutes between two minutes (inclusive).
    public func activeMinuteCount(from: MinuteT, to: MinuteT) throws -> Int {
        Int(try query("SELECT COUNT(*) FROM active_minute WHERE t BETWEEN ? AND ?;",
                      [.int(from), .int(to)]) { $0.int(0) }.first ?? 0)
    }

    /// Adds meeting seconds for an app in a minute and marks the minute dirty.
    public func addMeetingSeconds(t: MinuteT, bundleId: String, appName: String, sec: Int) throws {
        try run("""
            INSERT INTO meeting_minute(t, bundle_id, app_name, sec) VALUES(?,?,?,?)
            ON CONFLICT(t, bundle_id) DO UPDATE SET sec = sec + excluded.sec, app_name = excluded.app_name;
            """, [.int(t), .text(bundleId), .text(appName), .int(Int64(sec))])
        try markMinuteDirty(t)
    }

    public func meetingSeconds(t: MinuteT) throws -> [AppSeconds] {
        try query("SELECT bundle_id, app_name, sec FROM meeting_minute WHERE t = ? ORDER BY sec DESC;", [.int(t)]) {
            AppSeconds(bundleId: $0.text(0), appName: $0.text(1), sec: Int($0.int(2)))
        }
    }

    /// Total meeting seconds between two minutes (inclusive).
    public func meetingTotal(from: MinuteT, to: MinuteT) throws -> Int {
        Int(try query("SELECT COALESCE(SUM(sec), 0) FROM meeting_minute WHERE t BETWEEN ? AND ?;",
                      [.int(from), .int(to)]) { $0.int(0) }.first ?? 0)
    }

    public func addTitleSeconds(t: MinuteT, bundleId: String, title: String, sec: Int) throws {
        try run("""
            INSERT INTO title_minute(t, bundle_id, title, sec) VALUES(?,?,?,?)
            ON CONFLICT(t, bundle_id, title) DO UPDATE SET sec = sec + excluded.sec;
            """, [.int(t), .text(bundleId), .text(title), .int(Int64(sec))])
    }

    public func titleTotals(from: MinuteT, to: MinuteT, limit: Int) throws -> [(title: String, sec: Int)] {
        try query("""
            SELECT title, SUM(sec) FROM title_minute WHERE t BETWEEN ? AND ?
            GROUP BY title ORDER BY SUM(sec) DESC LIMIT ?;
            """, [.int(from), .int(to), .int(Int64(limit))]) { (title: $0.text(0), sec: Int($0.int(1))) }
    }

    /// Deletes all local history for an app (used when it is marked private).
    public func deleteAppHistory(bundleId: String) throws {
        let minutes = try query("SELECT t FROM app_minute WHERE bundle_id = ?;", [.text(bundleId)]) { $0.int(0) }
        try run("DELETE FROM app_minute WHERE bundle_id = ?;", [.text(bundleId)])
        try run("DELETE FROM title_minute WHERE bundle_id = ?;", [.text(bundleId)])
        let meetingMinutes = try query("SELECT t FROM meeting_minute WHERE bundle_id = ?;", [.text(bundleId)]) { $0.int(0) }
        try run("DELETE FROM meeting_minute WHERE bundle_id = ?;", [.text(bundleId)])
        for t in Set(minutes + meetingMinutes) { try markMinuteDirty(t) }
    }

    // MARK: - Agent events and tokens

    public func insertEvents(agent: String, session: String, events: [AgentEvent]) throws {
        for e in events {
            try run("INSERT OR IGNORE INTO agent_event(agent, session, ts_ms, kind) VALUES(?,?,?,?);",
                    [.text(agent), .text(session), .int(ms(e.timestamp)), .int(Int64(e.kind.rawValue))])
        }
    }

    /// Upserts token rows; a later line for the same key replaces the earlier one.
    /// Returns the minutes whose token totals may have changed.
    @discardableResult
    public func upsertTokens(agent: String, session: String, events: [AgentEvent]) throws -> Set<MinuteT> {
        var touched = Set<MinuteT>()
        for e in events {
            guard let usage = e.tokens, let key = e.tokenKey else { continue }
            let previous = try query("SELECT ts_ms FROM agent_tokens WHERE agent=? AND session=? AND token_key=?;",
                                     [.text(agent), .text(session), .text(key)]) { $0.int(0) }
            if let prev = previous.first { touched.insert(minuteOfMs(prev)) }
            try run("""
                INSERT INTO agent_tokens(agent, session, token_key, ts_ms, tokens_in, tokens_cached, tokens_out)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(agent, session, token_key) DO UPDATE SET ts_ms = excluded.ts_ms,
                    tokens_in = excluded.tokens_in, tokens_cached = excluded.tokens_cached,
                    tokens_out = excluded.tokens_out;
                """, [.text(agent), .text(session), .text(key), .int(ms(e.timestamp)),
                      .int(usage.input), .int(usage.cached), .int(usage.output)])
            touched.insert(minuteOf(e.timestamp))
        }
        return touched
    }

    /// Latest human event at or before `time`.
    public func lastHumanEvent(agent: String, session: String, atOrBefore time: Date) throws -> Date? {
        try query("""
            SELECT MAX(ts_ms) FROM agent_event WHERE agent=? AND session=? AND kind=0 AND ts_ms <= ?;
            """, [.text(agent), .text(session), .int(ms(time))]) { $0.isNull(0) ? nil : $0.int(0) }
            .first.flatMap { $0 }.map(dateOfMs)
    }

    public func firstEvent(agent: String, session: String) throws -> Date? {
        try query("SELECT MIN(ts_ms) FROM agent_event WHERE agent=? AND session=?;",
                  [.text(agent), .text(session)]) { $0.isNull(0) ? nil : $0.int(0) }
            .first.flatMap { $0 }.map(dateOfMs)
    }

    public func events(agent: String, session: String, from: Date) throws -> [AgentEvent] {
        try query("SELECT ts_ms, kind FROM agent_event WHERE agent=? AND session=? AND ts_ms >= ? ORDER BY ts_ms;",
                  [.text(agent), .text(session), .int(ms(from))]) {
            AgentEvent(timestamp: dateOfMs($0.int(0)), kind: EventKind(rawValue: Int($0.int(1))) ?? .agent)
        }
    }

    public func tokenRecords(agent: String, session: String, from: Date) throws -> [TokenRecord] {
        try query("""
            SELECT ts_ms, tokens_in, tokens_cached, tokens_out FROM agent_tokens
            WHERE agent=? AND session=? AND ts_ms >= ?;
            """, [.text(agent), .text(session), .int(ms(from))]) {
            TokenRecord(timestamp: dateOfMs($0.int(0)),
                        usage: TokenUsage(input: $0.int(1), cached: $0.int(2), output: $0.int(3)))
        }
    }

    // MARK: - Session minutes

    public func sessionMinutes(agent: String, session: String, from: MinuteT) throws -> [MinuteT: Double] {
        let rows = try query("SELECT t, sec FROM session_minute WHERE agent=? AND session=? AND t >= ?;",
                             [.text(agent), .text(session), .int(from)]) { ($0.int(0), $0.double(1)) }
        return Dictionary(rows, uniquingKeysWith: +)
    }

    /// Replaces a session's minutes from `from` onward with `rows`.
    public func replaceSessionMinutes(agent: String, session: String, from: MinuteT, rows: [MinuteT: Double]) throws {
        try run("DELETE FROM session_minute WHERE agent=? AND session=? AND t >= ?;",
                [.text(agent), .text(session), .int(from)])
        for (t, sec) in rows where t >= from && sec > 0 {
            try run("INSERT INTO session_minute(agent, session, t, sec) VALUES(?,?,?,?);",
                    [.text(agent), .text(session), .int(t), .double(sec)])
        }
    }

    /// Sets one minute for a session (used by the process-scan fallback).
    public func setSessionMinute(agent: String, session: String, t: MinuteT, sec: Double) throws {
        try run("""
            INSERT INTO session_minute(agent, session, t, sec) VALUES(?,?,?,?)
            ON CONFLICT(agent, session, t) DO UPDATE SET sec = excluded.sec;
            """, [.text(agent), .text(session), .int(t), .double(sec)])
        try markMinuteDirty(t)
    }

    // MARK: - Aggregates for upload and the menu bar

    /// Per-agent rows for one minute, as sent in the ingest payload.
    public func agentEntries(t: MinuteT) throws -> [AgentEntry] {
        struct Time { var sec: Double; var sessions: Int }
        var times: [String: Time] = [:]
        let timeRows = try query("SELECT agent, SUM(sec), COUNT(*) FROM session_minute WHERE t = ? GROUP BY agent;",
                                 [.int(t)]) { ($0.text(0), $0.double(1), Int($0.int(2))) }
        for (agent, sec, sessions) in timeRows { times[agent] = Time(sec: sec, sessions: sessions) }

        var tokens: [String: TokenUsage] = [:]
        let tokenRows = try query("""
            SELECT agent, SUM(tokens_in), SUM(tokens_cached), SUM(tokens_out) FROM agent_tokens
            WHERE ts_ms >= ? AND ts_ms < ? GROUP BY agent;
            """, [.int(t * 1000), .int((t + 60) * 1000)]) {
            ($0.text(0), TokenUsage(input: $0.int(1), cached: $0.int(2), output: $0.int(3)))
        }
        for (agent, usage) in tokenRows { tokens[agent] = usage }

        let agents = Set(times.keys).union(tokens.keys).sorted()
        return agents.compactMap { agent in
            let time = times[agent] ?? Time(sec: 0, sessions: 0)
            let usage = tokens[agent] ?? TokenUsage(input: 0, cached: 0, output: 0)
            let sec = Int(time.sec.rounded())
            if sec == 0 && usage.input == 0 && usage.cached == 0 && usage.output == 0 { return nil }
            return AgentEntry(agent: agent, sec: sec, sessions: time.sessions, peak: time.sessions,
                              tokensIn: usage.input, tokensCached: usage.cached, tokensOut: usage.output)
        }
    }

    /// Total agent seconds between two minutes (inclusive).
    public func agentSeconds(from: MinuteT, to: MinuteT) throws -> Double {
        try query("SELECT COALESCE(SUM(sec), 0) FROM session_minute WHERE t BETWEEN ? AND ?;",
                  [.int(from), .int(to)]) { $0.double(0) }.first ?? 0
    }

    /// Human seconds: 60 per active minute.
    /// Human time: 60 s per active minute, minus any call time in it (a call
    /// wins the minute, matching the server), so human + meetings never overlap.
    public func humanSeconds(from: MinuteT, to: MinuteT) throws -> Int {
        Int(try query("""
            SELECT COALESCE(SUM(60 - MIN(60, COALESCE(m.sec, 0))), 0)
            FROM active_minute a
            LEFT JOIN (SELECT t, SUM(sec) AS sec FROM meeting_minute GROUP BY t) m ON m.t = a.t
            WHERE a.t BETWEEN ? AND ?;
            """, [.int(from), .int(to)]) { $0.int(0) }.first ?? 0)
    }

    /// Number of distinct sessions with working time in the given minutes.
    public func activeSessionCount(from: MinuteT, to: MinuteT) throws -> Int {
        Int(try query("SELECT COUNT(DISTINCT agent || ':' || session) FROM session_minute WHERE t BETWEEN ? AND ?;",
                      [.int(from), .int(to)]) { $0.int(0) }.first ?? 0)
    }

    public struct ChatSummary: Equatable {
        public var agent: String
        public var session: String
        public var firstAt: Date
        public var lastAt: Date
        public var agentSec: Double
        public var turns: Int
        public var tokens: TokenUsage
    }

    /// A chat's summary: what's folded into `chat_base` (raw events pruned after
    /// the session went quiet for 30 days) plus whatever raw events remain.
    public func chatSummary(agent: String, session: String) throws -> ChatSummary? {
        let live = try query("""
            SELECT MIN(ts_ms), MAX(ts_ms), SUM(kind = 0) FROM agent_event WHERE agent=? AND session=?;
            """, [.text(agent), .text(session)]) { row -> (Int64, Int64, Int)? in
            row.isNull(0) ? nil : (row.int(0), row.int(1), Int(row.int(2)))
        }.first.flatMap { $0 }
        let base = try chatBase(agent: agent, session: session)
        guard live != nil || base != nil else { return nil }
        let first = min(live?.0 ?? .max, base?.firstMs ?? .max)
        let last = max(live?.1 ?? .min, base?.lastMs ?? .min)
        let turns = (live?.2 ?? 0) + (base?.turns ?? 0)
        let sec = try query("SELECT COALESCE(SUM(sec), 0) FROM session_minute WHERE agent=? AND session=?;",
                            [.text(agent), .text(session)]) { $0.double(0) }.first ?? 0
        let usage = try query("""
            SELECT COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_cached),0), COALESCE(SUM(tokens_out),0)
            FROM agent_tokens WHERE agent=? AND session=?;
            """, [.text(agent), .text(session)]) {
            TokenUsage(input: $0.int(0), cached: $0.int(1), output: $0.int(2))
        }.first ?? TokenUsage(input: 0, cached: 0, output: 0)
        let baseTokens = base?.tokens ?? TokenUsage(input: 0, cached: 0, output: 0)
        return ChatSummary(agent: agent, session: session, firstAt: dateOfMs(first), lastAt: dateOfMs(last),
                           agentSec: sec, turns: turns,
                           tokens: TokenUsage(input: usage.input + baseTokens.input, cached: usage.cached + baseTokens.cached,
                                              output: usage.output + baseTokens.output))
    }

    struct ChatBase {
        var firstMs: Int64
        var lastMs: Int64
        var turns: Int
        var tokens: TokenUsage
    }

    func chatBase(agent: String, session: String) throws -> ChatBase? {
        try query("""
            SELECT first_ms, last_ms, turns, tokens_in, tokens_cached, tokens_out FROM chat_base WHERE agent=? AND session=?;
            """, [.text(agent), .text(session)]) {
            ChatBase(firstMs: $0.int(0), lastMs: $0.int(1), turns: Int($0.int(2)),
                     tokens: TokenUsage(input: $0.int(3), cached: $0.int(4), output: $0.int(5)))
        }.first
    }

    // MARK: - Dirty tracking

    public func markMinuteDirty(_ t: MinuteT) throws {
        try run("INSERT OR IGNORE INTO dirty_minute(t) VALUES(?);", [.int(t)])
    }

    public func dirtyMinutes(limit: Int) throws -> [MinuteT] {
        try query("SELECT t FROM dirty_minute ORDER BY t LIMIT ?;", [.int(Int64(limit))]) { $0.int(0) }
    }

    public func clearDirtyMinutes(_ ts: [MinuteT]) throws {
        for t in ts { try run("DELETE FROM dirty_minute WHERE t = ?;", [.int(t)]) }
    }

    public func markChatDirty(agent: String, session: String) throws {
        try run("INSERT OR IGNORE INTO dirty_chat(agent, session) VALUES(?,?);", [.text(agent), .text(session)])
    }

    public func dirtyChats(limit: Int) throws -> [(agent: String, session: String)] {
        try query("SELECT agent, session FROM dirty_chat LIMIT ?;", [.int(Int64(limit))]) {
            (agent: $0.text(0), session: $0.text(1))
        }
    }

    public func clearDirtyChats(_ chats: [(agent: String, session: String)]) throws {
        for c in chats {
            try run("DELETE FROM dirty_chat WHERE agent=? AND session=?;", [.text(c.agent), .text(c.session)])
        }
    }

    /// Chat ids the server should forget (e.g. sub-agent chats merged into their parent).
    public func addDeletedChat(_ id: String) throws {
        try run("INSERT OR IGNORE INTO deleted_chat(chat_id) VALUES(?);", [.text(id)])
    }

    public func deletedChats(limit: Int) throws -> [String] {
        try query("SELECT chat_id FROM deleted_chat ORDER BY chat_id LIMIT ?;", [.int(Int64(limit))]) { $0.text(0) }
    }

    public func clearDeletedChats(_ ids: [String]) throws {
        for id in ids { try run("DELETE FROM deleted_chat WHERE chat_id = ?;", [.text(id)]) }
    }

    // MARK: - Sub-agent merge (one-time migration)

    /// Claude sessions stored under their own `<parent>/<stem>` id by version 1.
    public func claudeSubagentSessions() throws -> [String] {
        try query("""
            SELECT session FROM agent_event WHERE agent='claude' AND instr(session, '/') > 0
            UNION SELECT session FROM agent_tokens WHERE agent='claude' AND instr(session, '/') > 0
            UNION SELECT session FROM session_minute WHERE agent='claude' AND instr(session, '/') > 0;
            """) { $0.text(0) }
    }

    /// Moves a sub-agent session's events and tokens into `parent` and drops its
    /// own minutes and chat. Returns the minutes it had working time in.
    /// Version 1 read a sub-agent's prompts as human events; they are the parent
    /// agent's hand-over, so they become agent events first.
    public func mergeSession(agent: String, session: String, into parent: String) throws -> [MinuteT] {
        try run("UPDATE OR IGNORE agent_event SET kind = 1 WHERE agent = ? AND session = ? AND kind = 0;",
                [.text(agent), .text(session)])
        try run("UPDATE OR IGNORE agent_event SET session = ? WHERE agent = ? AND session = ?;",
                [.text(parent), .text(agent), .text(session)])
        try run("DELETE FROM agent_event WHERE agent = ? AND session = ?;", [.text(agent), .text(session)])
        try run("UPDATE OR IGNORE agent_tokens SET session = ? WHERE agent = ? AND session = ?;",
                [.text(parent), .text(agent), .text(session)])
        try run("DELETE FROM agent_tokens WHERE agent = ? AND session = ?;", [.text(agent), .text(session)])
        let minutes = try query("SELECT t FROM session_minute WHERE agent = ? AND session = ?;",
                                [.text(agent), .text(session)]) { $0.int(0) }
        try run("DELETE FROM session_minute WHERE agent = ? AND session = ?;", [.text(agent), .text(session)])
        try run("DELETE FROM dirty_chat WHERE agent = ? AND session = ?;", [.text(agent), .text(session)])
        for t in minutes { try markMinuteDirty(t) }
        return minutes
    }

    // MARK: - File cursors

    public struct FileCursor: Equatable {
        public var inode: UInt64
        public var offset: Int64

        public init(inode: UInt64, offset: Int64) {
            self.inode = inode
            self.offset = offset
        }
    }

    public func fileCursor(path: String) throws -> FileCursor? {
        try query("SELECT inode, offset FROM file_cursor WHERE path = ?;", [.text(path)]) {
            FileCursor(inode: UInt64(bitPattern: $0.int(0)), offset: $0.int(1))
        }.first
    }

    public func saveFileCursor(path: String, cursor: FileCursor) throws {
        try run("""
            INSERT INTO file_cursor(path, inode, offset) VALUES(?,?,?)
            ON CONFLICT(path) DO UPDATE SET inode = excluded.inode, offset = excluded.offset;
            """, [.text(path), .int(Int64(bitPattern: cursor.inode)), .int(cursor.offset)])
    }

    // MARK: - Key/value settings

    public func value(_ key: String) throws -> String? {
        try query("SELECT value FROM kv WHERE key = ?;", [.text(key)]) { $0.text(0) }.first
    }

    public func setValue(_ value: String?, for key: String) throws {
        if let value {
            try run("INSERT INTO kv(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
                    [.text(key), .text(value)])
        } else {
            try run("DELETE FROM kv WHERE key = ?;", [.text(key)])
        }
    }

    // MARK: - Retention

    /// Raw agent events are kept until a session has been quiet this long.
    public static let rawEventDays = 30
    /// Window titles (opt-in) are kept this long.
    public static let titleDays = 7

    /// Periodic clean-up.
    /// - Raw agent events and tokens of sessions quiet for 30 days are folded into
    ///   `chat_base` and deleted (they're most of the store's size); the per-minute
    ///   working time derived from them stays.
    /// - Window titles: 7 days. Upload queue entries: 30 days (the server ignores
    ///   older minutes anyway).
    /// - Everything else is kept forever, unless `keepDays` (the "Keep history"
    ///   setting) says otherwise.
    public func prune(now: Date = Date(), keepDays: Int? = nil) throws {
        let nowMinute = minuteOf(now)
        try foldQuietSessions(before: (nowMinute - Int64(Self.rawEventDays) * 86_400) * 1000)
        try run("DELETE FROM title_minute WHERE t < ?;", [.int(nowMinute - Int64(Self.titleDays) * 86_400)])
        try run("DELETE FROM dirty_minute WHERE t < ?;", [.int(nowMinute - Int64(Self.rawEventDays) * 86_400)])
        if let keepDays {
            try deleteHistory(before: dateOfMinute(nowMinute - Int64(keepDays) * 86_400))
        }
    }

    /// Folds the raw events and tokens of every session whose last activity is
    /// before `cutoffMs` into `chat_base`, then deletes them. A session is only
    /// folded whole, so a later resume never recomputes over a partial history.
    func foldQuietSessions(before cutoffMs: Int64) throws {
        let quiet = try query("""
            SELECT agent, session FROM (
                SELECT agent, session, MAX(ts_ms) AS last FROM agent_event GROUP BY agent, session
                UNION ALL
                SELECT agent, session, MAX(ts_ms) AS last FROM agent_tokens GROUP BY agent, session)
            GROUP BY agent, session HAVING MAX(last) < ?;
            """, [.int(cutoffMs)]) { (agent: $0.text(0), session: $0.text(1)) }
        guard !quiet.isEmpty else { return }
        try transaction {
            for s in quiet {
                let events = try query("""
                    SELECT MIN(ts_ms), MAX(ts_ms), COALESCE(SUM(kind = 0), 0) FROM agent_event WHERE agent=? AND session=?;
                    """, [.text(s.agent), .text(s.session)]) { row -> (Int64?, Int64?, Int) in
                    (row.isNull(0) ? nil : row.int(0), row.isNull(1) ? nil : row.int(1), Int(row.int(2)))
                }.first ?? (nil, nil, 0)
                let tokens = try query("""
                    SELECT MIN(ts_ms), MAX(ts_ms), COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_cached),0), COALESCE(SUM(tokens_out),0)
                    FROM agent_tokens WHERE agent=? AND session=?;
                    """, [.text(s.agent), .text(s.session)]) { row -> (Int64?, Int64?, TokenUsage) in
                    (row.isNull(0) ? nil : row.int(0), row.isNull(1) ? nil : row.int(1),
                     TokenUsage(input: row.int(2), cached: row.int(3), output: row.int(4)))
                }.first ?? (nil, nil, TokenUsage(input: 0, cached: 0, output: 0))
                // Chat bounds come from events; a token-only session falls back to token times.
                guard let first = events.0 ?? tokens.0, let last = events.1 ?? tokens.1 else { continue }
                try run("""
                    INSERT INTO chat_base(agent, session, first_ms, last_ms, turns, tokens_in, tokens_cached, tokens_out)
                    VALUES(?,?,?,?,?,?,?,?)
                    ON CONFLICT(agent, session) DO UPDATE SET
                        first_ms = MIN(first_ms, excluded.first_ms), last_ms = MAX(last_ms, excluded.last_ms),
                        turns = turns + excluded.turns, tokens_in = tokens_in + excluded.tokens_in,
                        tokens_cached = tokens_cached + excluded.tokens_cached, tokens_out = tokens_out + excluded.tokens_out;
                    """, [.text(s.agent), .text(s.session), .int(first), .int(last), .int(Int64(events.2)),
                          .int(tokens.2.input), .int(tokens.2.cached), .int(tokens.2.output)])
                try run("DELETE FROM agent_event WHERE agent=? AND session=?;", [.text(s.agent), .text(s.session)])
                try run("DELETE FROM agent_tokens WHERE agent=? AND session=?;", [.text(s.agent), .text(s.session)])
            }
        }
    }

    /// Deletes local history before `date`: per-minute data, raw agent data,
    /// folded chats and window titles, plus their upload-queue entries so nothing
    /// half-deleted is sent. Never touches the server.
    public func deleteHistory(before date: Date) throws {
        let t = minuteOf(date)
        let ms = t * 1000
        try transaction {
            for table in ["app_minute", "active_minute", "meeting_minute", "session_minute", "title_minute"] {
                try run("DELETE FROM \(table) WHERE t < ?;", [.int(t)])
            }
            try run("DELETE FROM agent_event WHERE ts_ms < ?;", [.int(ms)])
            try run("DELETE FROM agent_tokens WHERE ts_ms < ?;", [.int(ms)])
            // A folded chat that ended before the cutoff goes too, and won't be re-sent.
            try run("""
                DELETE FROM dirty_chat WHERE EXISTS (
                    SELECT 1 FROM chat_base b WHERE b.agent = dirty_chat.agent AND b.session = dirty_chat.session AND b.last_ms < ?)
                AND NOT EXISTS (SELECT 1 FROM agent_event e WHERE e.agent = dirty_chat.agent AND e.session = dirty_chat.session);
                """, [.int(ms)])
            try run("DELETE FROM chat_base WHERE last_ms < ?;", [.int(ms)])
            try run("DELETE FROM dirty_minute WHERE t < ?;", [.int(t)])
        }
    }

    /// Deletes all local activity history and the upload queue. Settings, the
    /// pairing and log-file positions stay, so old agent logs aren't re-imported.
    public func deleteAllHistory() throws {
        try transaction {
            for table in ["app_minute", "active_minute", "meeting_minute", "session_minute", "title_minute",
                          "agent_event", "agent_tokens", "chat_base", "dirty_minute", "dirty_chat"] {
                try run("DELETE FROM \(table);")
            }
        }
    }

    // MARK: - Ranges for the activity dashboard

    public struct MinuteSeconds: Equatable {
        public var t: MinuteT
        public var id: String
        public var name: String
        public var sec: Int
    }

    public struct AgentMinute: Equatable {
        public var t: MinuteT
        public var agent: String
        public var sec: Double
        public var sessions: Int
    }

    /// Active minutes in [from, to).
    public func activeMinutes(from: MinuteT, to: MinuteT) throws -> [MinuteT] {
        try query("SELECT t FROM active_minute WHERE t >= ? AND t < ? ORDER BY t;", [.int(from), .int(to)]) { $0.int(0) }
    }

    /// App shares per minute in [from, to).
    public func appMinutes(from: MinuteT, to: MinuteT) throws -> [MinuteSeconds] {
        try query("SELECT t, bundle_id, app_name, sec FROM app_minute WHERE t >= ? AND t < ? ORDER BY t;",
                  [.int(from), .int(to)]) { MinuteSeconds(t: $0.int(0), id: $0.text(1), name: $0.text(2), sec: Int($0.int(3))) }
    }

    /// Call seconds per app per minute in [from, to).
    public func meetingMinutes(from: MinuteT, to: MinuteT) throws -> [MinuteSeconds] {
        try query("SELECT t, bundle_id, app_name, sec FROM meeting_minute WHERE t >= ? AND t < ? ORDER BY t;",
                  [.int(from), .int(to)]) { MinuteSeconds(t: $0.int(0), id: $0.text(1), name: $0.text(2), sec: Int($0.int(3))) }
    }

    /// Agent seconds and sessions per agent per minute in [from, to).
    public func agentMinutes(from: MinuteT, to: MinuteT) throws -> [AgentMinute] {
        try query("""
            SELECT t, agent, SUM(sec), COUNT(*) FROM session_minute WHERE t >= ? AND t < ? GROUP BY t, agent ORDER BY t;
            """, [.int(from), .int(to)]) { AgentMinute(t: $0.int(0), agent: $0.text(1), sec: $0.double(2), sessions: Int($0.int(3))) }
    }

    // MARK: - SQLite plumbing

    public enum Value {
        case int(Int64)
        case double(Double)
        case text(String)
    }

    public struct Row {
        fileprivate let stmt: OpaquePointer
        public func int(_ i: Int32) -> Int64 { sqlite3_column_int64(stmt, i) }
        public func double(_ i: Int32) -> Double { sqlite3_column_double(stmt, i) }
        public func isNull(_ i: Int32) -> Bool { sqlite3_column_type(stmt, i) == SQLITE_NULL }
        public func text(_ i: Int32) -> String {
            guard let c = sqlite3_column_text(stmt, i) else { return "" }
            return String(cString: c)
        }
    }

    private func execute(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &err) == SQLITE_OK else {
            let message = err.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(err)
            throw StoreError.failed(sql, message)
        }
    }

    private func prepare(_ sql: String, _ args: [Value]) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw StoreError.failed(sql, errorMessage)
        }
        for (i, arg) in args.enumerated() {
            let index = Int32(i + 1)
            switch arg {
            case .int(let v): sqlite3_bind_int64(stmt, index, v)
            case .double(let v): sqlite3_bind_double(stmt, index, v)
            case .text(let v): sqlite3_bind_text(stmt, index, v, -1, SQLITE_TRANSIENT)
            }
        }
        return stmt
    }

    private func run(_ sql: String, _ args: [Value] = []) throws {
        let stmt = try prepare(sql, args)
        defer { sqlite3_finalize(stmt) }
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw StoreError.failed(sql, errorMessage) }
    }

    /// Runs a statement and returns how many rows it changed.
    private func runCountingChanges(_ sql: String, _ args: [Value] = []) throws -> Int32 {
        try run(sql, args)
        return sqlite3_changes(db)
    }

    private func query<T>(_ sql: String, _ args: [Value] = [], _ map: (Row) throws -> T) throws -> [T] {
        let stmt = try prepare(sql, args)
        defer { sqlite3_finalize(stmt) }
        var out: [T] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw StoreError.failed(sql, errorMessage) }
            out.append(try map(Row(stmt: stmt)))
        }
        return out
    }

    private var errorMessage: String {
        sqlite3_errmsg(db).map { String(cString: $0) } ?? "unknown"
    }
}

public enum StoreError: Error, CustomStringConvertible {
    case cannotOpen(String)
    case failed(String, String)

    public var description: String {
        switch self {
        case .cannotOpen(let path): return "Cannot open store at \(path)"
        case .failed(let sql, let message): return "SQLite error: \(message) — \(sql)"
        }
    }
}

// MARK: - Millisecond helpers

func ms(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }
func dateOfMs(_ value: Int64) -> Date { Date(timeIntervalSince1970: TimeInterval(value) / 1000) }
func minuteOfMs(_ value: Int64) -> MinuteT { (value / 60_000) * 60 }

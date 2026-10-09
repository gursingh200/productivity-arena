import Foundation
import CryptoKit

// MARK: - Agent events

/// Who produced a log entry. A `human` event starts a new turn; everything the
/// agent does (model replies, tool calls, tool results) is an `agent` event.
public enum EventKind: Int, Sendable {
    case human = 0
    case agent = 1
}

/// Token usage for one model message.
/// - `input`: uncached input + cache writes
/// - `cached`: cache reads
/// - `output`: output including reasoning
public struct TokenUsage: Equatable, Sendable {
    public var input: Int64
    public var cached: Int64
    public var output: Int64

    public init(input: Int64, cached: Int64, output: Int64) {
        self.input = input
        self.cached = cached
        self.output = output
    }
}

/// One meaningful entry from a coding agent's local log.
///
/// `tokenKey` identifies the model message the tokens belong to. Several log
/// lines can carry the same key (Claude streams one message over several lines,
/// Codex repeats token_count events); the store keeps one row per key, so
/// tokens are never double counted.
public struct AgentEvent: Equatable, Sendable {
    public var timestamp: Date
    public var kind: EventKind
    public var tokens: TokenUsage?
    public var tokenKey: String?
    /// Which thread of the session: "" for the main one, else a sub-agent's id.
    public var thread: String

    public init(timestamp: Date, kind: EventKind, tokens: TokenUsage? = nil, tokenKey: String? = nil, thread: String = "") {
        self.timestamp = timestamp
        self.kind = kind
        self.tokens = tokens
        self.tokenKey = tokenKey
        self.thread = thread
    }
}

/// A token row as stored: when it happened and how much output it had.
public struct TokenRecord: Equatable, Sendable {
    public var timestamp: Date
    public var usage: TokenUsage

    public init(timestamp: Date, usage: TokenUsage) {
        self.timestamp = timestamp
        self.usage = usage
    }
}

// MARK: - Minute buckets

/// Wall-clock minute as seconds since epoch, truncated to the minute.
public typealias MinuteT = Int64

public func minuteOf(_ date: Date) -> MinuteT {
    MinuteT((date.timeIntervalSince1970 / 60).rounded(.down)) * 60
}

public func dateOfMinute(_ t: MinuteT) -> Date {
    Date(timeIntervalSince1970: TimeInterval(t))
}

// MARK: - Chat id

/// First 16 hex chars of sha256(agent + ":" + sessionId). Spec §1.3.
public func chatId(agent: String, sessionId: String) -> String {
    let hash = SHA256.hash(data: Data("\(agent):\(sessionId)".utf8))
    let hex = hash.map { String(format: "%02x", $0) }.joined()
    return String(hex.prefix(16))
}

// MARK: - Ingest payload (spec §3.1)

public struct DeviceInfo: Codable, Equatable {
    public var id: String
    public var name: String
    public var os: String
    public var agentVersion: String
    /// The Mac's IANA timezone; the server counts this person's days in it,
    /// so the website and this Mac agree on what "Monday" is.
    public var timezone: String?

    public init(id: String, name: String, os: String, agentVersion: String, timezone: String? = TimeZone.current.identifier) {
        self.id = id
        self.name = name
        self.os = os
        self.agentVersion = agentVersion
        self.timezone = timezone
    }
}

public struct AppEntry: Codable, Equatable {
    public var id: String
    public var name: String?
    public var sec: Int

    public init(id: String, name: String?, sec: Int) {
        self.id = id
        self.name = name
        self.sec = sec
    }

    // Encode `name` as an explicit null for private apps, as the spec shows.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(sec, forKey: .sec)
    }
}

public struct AgentEntry: Codable, Equatable {
    public var agent: String
    public var sec: Int
    public var sessions: Int
    public var peak: Int
    public var tokensIn: Int64
    public var tokensCached: Int64
    public var tokensOut: Int64
    /// Total seconds: each thread (main and every sub-agent) counted on its own, ≥ sec.
    public var workSec: Int?
    /// Threads working in this minute, sub-agents included.
    public var threads: Int?

    public init(agent: String, sec: Int, sessions: Int, peak: Int, tokensIn: Int64, tokensCached: Int64, tokensOut: Int64,
                workSec: Int? = nil, threads: Int? = nil) {
        self.agent = agent
        self.sec = sec
        self.sessions = sessions
        self.peak = peak
        self.tokensIn = tokensIn
        self.tokensCached = tokensCached
        self.tokensOut = tokensOut
        self.workSec = workSec
        self.threads = threads
    }
}

public struct MinutePayload: Codable, Equatable {
    public var t: String
    public var apps: [AppEntry]
    public var agents: [AgentEntry]
    /// Meeting seconds per app (call apps using the microphone); omitted when none.
    public var meetings: [AppEntry]?

    public init(t: String, apps: [AppEntry], agents: [AgentEntry], meetings: [AppEntry]? = nil) {
        self.t = t
        self.apps = apps
        self.agents = agents
        self.meetings = meetings
    }
}

public struct ChatPayload: Codable, Equatable {
    public var agent: String
    public var chatId: String
    public var firstAt: String
    public var lastAt: String
    public var agentSec: Int64
    public var turns: Int
    public var tokensIn: Int64
    public var tokensCached: Int64
    public var tokensOut: Int64

    public init(agent: String, chatId: String, firstAt: String, lastAt: String, agentSec: Int64, turns: Int,
                tokensIn: Int64, tokensCached: Int64, tokensOut: Int64) {
        self.agent = agent
        self.chatId = chatId
        self.firstAt = firstAt
        self.lastAt = lastAt
        self.agentSec = agentSec
        self.turns = turns
        self.tokensIn = tokensIn
        self.tokensCached = tokensCached
        self.tokensOut = tokensOut
    }
}

public struct IngestPayload: Codable, Equatable {
    public var schema: Int
    public var device: DeviceInfo
    public var minutes: [MinutePayload]
    public var chats: [ChatPayload]?
    /// Chat ids the server should delete (sub-agent chats merged into their parent).
    public var deletedChats: [String]?

    public init(device: DeviceInfo, minutes: [MinutePayload], chats: [ChatPayload]?, deletedChats: [String]? = nil) {
        self.schema = 1
        self.device = device
        self.minutes = minutes
        self.chats = chats
        self.deletedChats = deletedChats
    }
}

// MARK: - Status payload (spec §3.2)
// Decoded leniently: every field is optional so a server-side addition or a
// missing value never breaks the menu bar.

public struct StatusUser: Codable, Equatable {
    public var name: String?
    public var handle: String?
    public var level: Int?
    public var xp: Int?
    public var xpForNext: Int?
    public var league: String?
    public var weeklyRank: Int?
    public var weeklyOf: Int?
}

public struct StatusToday: Codable, Equatable {
    public var humanSec: Int64?
    public var agentSec: Int64?
    public var xp: Int?
}

public struct QuestStatus: Codable, Equatable {
    public var id: String
    public var kind: String
    public var title: String
    public var xp: Int
    public var progress: Double?
    public var target: Double?
    public var unit: String?
    public var state: String
    public var expiresAt: String?
}

extension QuestStatus {
    /// How many quests the menu shows.
    public static let menuCount = 3

    /// The quests the menu shows: offers first (they need an answer), then the
    /// active quests closest to done, three at most.
    public static func forMenu(_ quests: [QuestStatus]) -> (offered: [QuestStatus], active: [QuestStatus]) {
        let offered = Array(quests.filter { $0.state == "offered" }.prefix(menuCount))
        let done: (QuestStatus) -> Double = { q in
            guard let target = q.target, target > 0 else { return 0 }
            return min(1, (q.progress ?? 0) / target)
        }
        let active = quests.filter { $0.state == "active" }.sorted { done($0) > done($1) }
        return (offered, Array(active.prefix(menuCount - offered.count)))
    }
}

public struct StatusPayload: Codable, Equatable {
    public var user: StatusUser?
    public var today: StatusToday?
    public var quests: [QuestStatus]?
    public var dashboardUrl: String?
    /// The person's colours from the website (Settings → Appearance), as #rrggbb.
    public var appearance: StatusAppearance?
}

public struct StatusAppearance: Codable, Equatable, Sendable {
    public var bg: String
    public var panel: String
    public var raised: String
    public var line: String
    public var human: String
    public var agent: String
    public var meeting: String
    public var accent: String

    public init(bg: String, panel: String, raised: String, line: String, human: String, agent: String, meeting: String, accent: String) {
        self.bg = bg
        self.panel = panel
        self.raised = raised
        self.line = line
        self.human = human
        self.agent = agent
        self.meeting = meeting
        self.accent = accent
    }
}

public struct IngestResponse: Codable, Equatable {
    public var accepted: Int?
    public var status: StatusPayload?
}

// MARK: - ISO 8601

private let isoWithFraction: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

public func parseISO(_ s: String) -> Date? {
    isoWithFraction.date(from: s) ?? isoPlain.date(from: s)
}

public func formatISO(_ date: Date) -> String {
    isoPlain.string(from: date)
}

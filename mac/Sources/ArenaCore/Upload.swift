import Foundation

/// Builds ingest payloads from dirty local data. Spec §1.5 / §3.1.
public enum PayloadBuilder {

    public static let maxMinutes = 1440
    public static let maxChats = 2000

    public struct Built {
        public var payload: IngestPayload
        public var minutes: [MinuteT]
        public var chats: [(agent: String, session: String)]
        public var deletedChats: [String]

        public var isEmpty: Bool { minutes.isEmpty && chats.isEmpty && deletedChats.isEmpty }
    }

    /// Every dirty minute is sent, even when it is now empty, so the server
    /// replaces (and can clear) what it had for that minute.
    ///
    /// Human time: an active minute's app shares are scaled to exactly 60 s
    /// (the server sums them); a minute without input sends no apps.
    public static func build(store: Store, device: DeviceInfo) throws -> Built {
        let minutes = try store.dirtyMinutes(limit: maxMinutes)
        var minutePayloads: [MinutePayload] = []
        for t in minutes {
            let apps = try store.isActive(t) ? normalized(try store.appSeconds(t: t).map(entry)) : []
            let meetings = capped(try store.meetingSeconds(t: t).map(entry).map { m in
                // Calendar event titles never leave this Mac.
                var m = m
                if m.id == HumanRecorder.calendarBundleId { m.name = "Calendar meeting" }
                return m
            })
            minutePayloads.append(MinutePayload(t: formatISO(dateOfMinute(t)), apps: apps,
                                                agents: try store.agentEntries(t: t),
                                                meetings: meetings.isEmpty ? nil : meetings))
        }

        let chatKeys = try store.dirtyChats(limit: maxChats)
        var chatPayloads: [ChatPayload] = []
        for key in chatKeys where key.session != "process" {
            guard let chat = try store.chatSummary(agent: key.agent, session: key.session) else { continue }
            chatPayloads.append(ChatPayload(
                agent: chat.agent, chatId: chatId(agent: chat.agent, sessionId: chat.session),
                firstAt: formatISO(chat.firstAt), lastAt: formatISO(chat.lastAt),
                agentSec: Int64(chat.agentSec.rounded()), turns: chat.turns,
                tokensIn: chat.tokens.input, tokensCached: chat.tokens.cached, tokensOut: chat.tokens.output))
        }

        let deleted = try store.deletedChats(limit: maxChats)
        let payload = IngestPayload(device: device, minutes: minutePayloads, chats: chatPayloads.isEmpty ? nil : chatPayloads,
                                    deletedChats: deleted.isEmpty ? nil : deleted)
        return Built(payload: payload, minutes: minutes, chats: chatKeys, deletedChats: deleted)
    }

    private static func entry(_ app: Store.AppSeconds) -> AppEntry {
        AppEntry(id: app.bundleId, name: app.bundleId == "private" ? nil : app.appName, sec: app.sec)
    }

    /// Scales an active minute's app shares to sum to exactly 60 s
    /// (largest-remainder rounding). With no shares the minute goes to "Other".
    static func normalized(_ apps: [AppEntry]) -> [AppEntry] {
        let total = apps.reduce(0) { $0 + $1.sec }
        guard total > 0 else { return [AppEntry(id: "unknown", name: "Other", sec: 60)] }
        let exact = apps.map { Double($0.sec) * 60 / Double(total) }
        var result = apps
        for i in result.indices { result[i].sec = Int(exact[i].rounded(.down)) }
        var remaining = 60 - result.reduce(0) { $0 + $1.sec }
        // Hand the leftover seconds to the largest remainders, ties by larger share then id.
        let order = result.indices.sorted {
            let ra = exact[$0] - Double(result[$0].sec), rb = exact[$1] - Double(result[$1].sec)
            if ra != rb { return ra > rb }
            if apps[$0].sec != apps[$1].sec { return apps[$0].sec > apps[$1].sec }
            return apps[$0].id < apps[$1].id
        }
        for i in order where remaining > 0 {
            result[i].sec += 1
            remaining -= 1
        }
        return result.filter { $0.sec > 0 }.sorted { $0.sec != $1.sec ? $0.sec > $1.sec : $0.id < $1.id }
    }

    /// Seconds in a minute can't exceed 60; trim the largest entries if they do.
    static func capped(_ apps: [AppEntry]) -> [AppEntry] {
        var apps = apps.sorted { $0.sec > $1.sec }
        var excess = apps.reduce(0) { $0 + $1.sec } - 60
        var i = 0
        while excess > 0, i < apps.count {
            let cut = min(excess, apps[i].sec)
            apps[i].sec -= cut
            excess -= cut
            i += 1
        }
        return apps.filter { $0.sec > 0 }
    }
}

public enum APIError: Error, Equatable {
    case notPaired
    case unauthorized
    case badRequest
    case tooLarge
    case server(Int)
    case transport
}

/// HTTP client for the Arena server.
public final class ArenaClient: @unchecked Sendable {

    /// Written on the engine queue, read by uploads on other threads.
    private let lock = NSLock()
    private var _serverURL: URL?
    private var _token: String?
    private let session: URLSession

    public var serverURL: URL? {
        get { lock.withLock { _serverURL } }
        set { lock.withLock { _serverURL = newValue } }
    }
    public var token: String? {
        get { lock.withLock { _token } }
        set { lock.withLock { _token = newValue } }
    }

    public init(serverURL: URL?, token: String?, session: URLSession = .shared) {
        self._serverURL = serverURL
        self._token = token
        self.session = session
    }

    public func ingest(_ payload: IngestPayload) async throws -> IngestResponse {
        let data = try await send("POST", "api/ingest", body: try JSONEncoder().encode(payload))
        return try JSONDecoder().decode(IngestResponse.self, from: data)
    }

    public func status() async throws -> StatusPayload {
        try JSONDecoder().decode(StatusPayload.self, from: try await send("GET", "api/agent/status"))
    }

    public func acceptQuest(_ id: String) async throws {
        _ = try await send("POST", "api/agent/quests/\(id)/accept")
    }

    public func declineQuest(_ id: String) async throws {
        _ = try await send("POST", "api/agent/quests/\(id)/decline")
    }

    /// Reports Linear issues this Mac fetched itself; the server never sees the Linear key.
    public func reportLinear(_ issues: [LinearIssue]) async throws {
        _ = try await send("POST", "api/agent/linear", body: try JSONEncoder().encode(["issues": issues]))
    }

    public func disconnectLinear() async throws {
        _ = try await send("DELETE", "api/agent/linear")
    }

    private func send(_ method: String, _ path: String, body: Data? = nil) async throws -> Data {
        guard let serverURL, let token else { throw APIError.notPaired }
        var request = URLRequest(url: serverURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch code {
        case 200..<300: return data
        case 401: throw APIError.unauthorized
        case 400: throw APIError.badRequest
        case 413: throw APIError.tooLarge
        default: throw APIError.server(code)
        }
    }
}

/// Exponential backoff for failed uploads: 30 s doubling up to 30 min.
public struct Backoff {
    public static let initial: TimeInterval = 30
    public static let maximum: TimeInterval = 30 * 60

    public private(set) var nextAllowed: Date = .distantPast
    private var delay: TimeInterval = initial

    public init() {}

    public func allows(_ now: Date) -> Bool { now >= nextAllowed }

    public mutating func failed(at now: Date) {
        nextAllowed = now.addingTimeInterval(delay)
        delay = min(delay * 2, Self.maximum)
    }

    public mutating func succeeded() {
        delay = Self.initial
        nextAllowed = .distantPast
    }
}

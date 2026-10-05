import Foundation

/// User settings, persisted in the local store's key/value table.
public struct ArenaSettings: Equatable {
    public var serverURL: URL?
    public var privateApps: Set<String> = []
    public var windowTitlesEnabled = false
    /// Tracking is paused until this instant (`.distantFuture` = until resumed).
    public var pausedUntil: Date?
    public var deviceId: String = UUID().uuidString
    /// "Keep history" in days; nil keeps local history forever (the default).
    public var historyKeepDays: Int?

    public init() {}

    public func isPaused(at now: Date) -> Bool {
        guard let until = pausedUntil else { return false }
        return now < until
    }

    static let keys = (server: "settings.server", privateApps: "settings.privateApps",
                       titles: "settings.windowTitles", paused: "settings.pausedUntil", device: "settings.deviceId",
                       history: "settings.historyKeepDays")

    public static func load(from store: Store) throws -> ArenaSettings {
        var settings = ArenaSettings()
        settings.serverURL = try store.value(keys.server).flatMap(URL.init(string:))
        if let json = try store.value(keys.privateApps), let apps = try? JSONDecoder().decode([String].self, from: Data(json.utf8)) {
            settings.privateApps = Set(apps)
        }
        settings.windowTitlesEnabled = try store.value(keys.titles) == "1"
        settings.pausedUntil = try store.value(keys.paused).flatMap(Double.init).map(Date.init(timeIntervalSince1970:))
        settings.historyKeepDays = try store.value(keys.history).flatMap { Int($0) }
        if let device = try store.value(keys.device) {
            settings.deviceId = device
        } else {
            try store.setValue(settings.deviceId, for: keys.device)
        }
        return settings
    }

    public func save(to store: Store) throws {
        try store.setValue(serverURL?.absoluteString, for: Self.keys.server)
        let apps = String(decoding: try JSONEncoder().encode(privateApps.sorted()), as: UTF8.self)
        try store.setValue(apps, for: Self.keys.privateApps)
        try store.setValue(windowTitlesEnabled ? "1" : "0", for: Self.keys.titles)
        try store.setValue(pausedUntil.map { String($0.timeIntervalSince1970) }, for: Self.keys.paused)
        try store.setValue(deviceId, for: Self.keys.device)
        try store.setValue(historyKeepDays.map(String.init), for: Self.keys.history)
    }
}

/// Parses `arena://pair?server=<base-url>&token=<token>`. Spec §1.7.
public struct PairingLink: Equatable {
    public var server: URL
    public var token: String
    /// Set when the Mac started the pairing ("Connect to Arena…"): the value it
    /// sent the website, which must come back unchanged.
    public var state: String?

    public init?(_ string: String) {
        guard let components = URLComponents(string: string.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme == "arena", components.host == "pair",
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty,
              let serverString = components.queryItems?.first(where: { $0.name == "server" })?.value,
              let server = URL(string: serverString), server.scheme == "https" || server.scheme == "http"
        else { return nil }
        self.server = server
        self.token = token
        self.state = components.queryItems?.first(where: { $0.name == "state" })?.value
    }
}

/// Starting a pairing from the Mac: it opens the website's connect page with a
/// one-time value, and accepts the pairing link that comes back only if it
/// carries the same value.
public enum PairingRequest {
    public static func newState() -> String {
        (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    public static func connectURL(server: URL, state: String, deviceName: String) -> URL? {
        guard var components = URLComponents(url: server.appendingPathComponent("connect/mac"), resolvingAgainstBaseURL: false) else { return nil }
        components.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "name", value: deviceName)]
        return components.url
    }

    /// The website from the build (ARENA_SERVER_URL), if any.
    public static func builtInServer(_ info: [String: Any]?) -> URL? {
        (info?["ArenaServerURL"] as? String).flatMap(URL.init(string:))
    }
}

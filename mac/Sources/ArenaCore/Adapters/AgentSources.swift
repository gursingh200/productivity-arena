import Foundation

/// Where to look for agent logs. Injectable so tests and a future port can
/// point adapters at other roots.
public struct AgentPaths: Sendable {
    public var home: String
    public var environment: [String: String]

    public init(home: String = NSHomeDirectory(), environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.home = home
        self.environment = environment
    }

    func join(_ parts: String...) -> String {
        parts.reduce(home) { ($0 as NSString).appendingPathComponent($1) }
    }
}

/// An agent that writes one JSON object per line to files under some roots.
public protocol JSONLAgentSource: Sendable {
    /// Agent id sent to the server, e.g. "claude".
    var agent: String { get }
    /// Whether turns must spend output tokens to count (spec §1.3).
    var requireTokens: Bool { get }
    /// Directories to watch and scan.
    func roots(_ paths: AgentPaths) -> [String]
    /// Whether a file under a root is one of this agent's session logs.
    func isSessionFile(_ path: String) -> Bool
    /// Stable session id for a log file.
    func sessionId(forFile path: String) -> String
    /// Meaningful events in one log line (usually zero or one).
    func events(fromLine line: Data) -> [AgentEvent]
}

/// All log-file based agents, in a fixed order.
public let jsonlAgentSources: [any JSONLAgentSource] = [ClaudeSource(), CodexSource(), PiSource()]

// MARK: - Shared JSON helpers

/// Parses a line as a JSON object, or nil.
func jsonObject(_ line: Data) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: line)) as? [String: Any]
}

func int64(_ value: Any?) -> Int64 {
    switch value {
    case let n as NSNumber: return n.int64Value
    case let s as String: return Int64(s) ?? 0
    default: return 0
    }
}

func uniqueExisting(_ paths: [String]) -> [String] {
    var seen = Set<String>()
    return paths.filter { path in
        let resolved = (path as NSString).resolvingSymlinksInPath
        guard FileManager.default.fileExists(atPath: resolved), !seen.contains(resolved) else { return false }
        seen.insert(resolved)
        return true
    }
}

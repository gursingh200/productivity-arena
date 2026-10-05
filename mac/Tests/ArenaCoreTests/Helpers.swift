import Foundation
@testable import ArenaCore

/// A fixed "now" so lookback filtering is deterministic.
let testNow = parseISO("2026-10-05T12:00:00Z")!

func at(_ iso: String) -> Date { parseISO(iso)! }

func human(_ iso: String) -> AgentEvent { AgentEvent(timestamp: at(iso), kind: .human) }

func agent(_ iso: String, out: Int64? = nil, key: String? = nil) -> AgentEvent {
    var e = AgentEvent(timestamp: at(iso), kind: .agent)
    if let out {
        e.tokens = TokenUsage(input: 10, cached: 100, output: out)
        e.tokenKey = key ?? iso
    }
    return e
}

func tokenRecords(_ events: [AgentEvent]) -> [TokenRecord] {
    events.compactMap { e in e.tokens.map { TokenRecord(timestamp: e.timestamp, usage: $0) } }
}

/// A fresh temporary directory and store per test.
final class Sandbox {
    let dir: String
    let store: Store

    init() throws {
        dir = NSTemporaryDirectory() + "arena-tests-" + UUID().uuidString
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        store = try Store(path: dir + "/arena.db")
    }

    deinit { try? FileManager.default.removeItem(atPath: dir) }

    var paths: AgentPaths { AgentPaths(home: dir, environment: [:]) }

    func tracker() -> AgentTracker { AgentTracker(store: store, paths: paths, now: { testNow }) }

    /// Creates parent directories and writes text (replacing the file).
    func write(_ relative: String, _ text: String) throws -> String {
        let path = dir + "/" + relative
        try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent,
                                                withIntermediateDirectories: true)
        try text.write(toFile: path, atomically: false, encoding: .utf8)
        return path
    }

    func append(_ path: String, _ text: String) throws {
        let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(text.utf8))
        try handle.close()
    }

    func setModified(_ path: String, _ date: Date) throws {
        try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: path)
    }
}

func line(_ text: String) -> Data { Data(text.utf8) }

// MARK: - Synthetic log lines in the real formats

enum ClaudeLine {
    static func human(_ ts: String, text: String = "do the thing") -> String {
        #"{"type":"user","timestamp":"\#(ts)","sessionId":"s","origin":{"kind":"human"},"message":{"role":"user","content":"\#(text)"}}"#
    }
    static func assistant(_ ts: String, id: String, out: Int, input: Int = 3, cacheWrite: Int = 50, cacheRead: Int = 900) -> String {
        #"{"type":"assistant","timestamp":"\#(ts)","requestId":"r-\#(id)","message":{"id":"\#(id)","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":\#(input),"cache_creation_input_tokens":\#(cacheWrite),"cache_read_input_tokens":\#(cacheRead),"output_tokens":\#(out)}}}"#
    }
    /// The first line of a sub-agent log: the parent agent's task, as Claude Code writes it.
    static func sidechainPrompt(_ ts: String) -> String {
        #"{"type":"user","timestamp":"\#(ts)","isSidechain":true,"userType":"external","agentId":"a1","message":{"role":"user","content":"task"}}"#
    }
    static func toolResult(_ ts: String) -> String {
        #"{"type":"user","timestamp":"\#(ts)","toolUseResult":{"stdout":"x"},"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"x"}]}}"#
    }
    static func meta(_ ts: String) -> String {
        #"{"type":"user","isMeta":true,"timestamp":"\#(ts)","message":{"role":"user","content":"<local-command-caveat>"}}"#
    }
    static func title(_ ts: String) -> String {
        #"{"type":"ai-title","timestamp":"\#(ts)","title":"Something"}"#
    }
}

enum CodexLine {
    static func taskStarted(_ ts: String) -> String {
        #"{"timestamp":"\#(ts)","type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}"#
    }
    static func developerMessage(_ ts: String) -> String {
        #"{"timestamp":"\#(ts)","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"rules"}]}}"#
    }
    static func reasoning(_ ts: String) -> String {
        #"{"timestamp":"\#(ts)","type":"response_item","payload":{"type":"reasoning","summary":[]}}"#
    }
    static func toolCall(_ ts: String) -> String {
        #"{"timestamp":"\#(ts)","type":"response_item","payload":{"type":"function_call","name":"exec","arguments":"{}"}}"#
    }
    static func tokenCount(_ ts: String, total: Int, input: Int, cached: Int, out: Int) -> String {
        #"{"timestamp":"\#(ts)","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":\#(total)},"last_token_usage":{"input_tokens":\#(input),"cached_input_tokens":\#(cached),"cache_write_input_tokens":0,"output_tokens":\#(out),"reasoning_output_tokens":0,"total_tokens":\#(input + out)}}}}"#
    }
    static func taskComplete(_ ts: String) -> String {
        #"{"timestamp":"\#(ts)","type":"event_msg","payload":{"type":"task_complete","turn_id":"t"}}"#
    }
}

func lines(_ items: String...) -> String { items.map { $0 + "\n" }.joined() }

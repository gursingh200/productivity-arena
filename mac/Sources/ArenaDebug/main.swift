// arena-debug: runs the real tracking pipeline over this machine's agent logs
// into a throwaway store and prints aggregate numbers only (no content, no ids).
import Foundation
import ArenaCore

let storePath = NSTemporaryDirectory() + "arena-debug-\(getpid()).db"
defer {
    for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: storePath + suffix) }
}

let store = try Store(path: storePath)
let tracker = AgentTracker(store: store)
let started = Date()

for source in jsonlAgentSources {
    let files = tracker.sessionFiles(for: source)
    for file in files { try tracker.processFile(file, source: source) }
    print("\(source.agent): \(files.count) files scanned")
}
try tracker.scanOpenCode()
try tracker.scanCursor()
let elapsed = Date().timeIntervalSince(started)

let built = try PayloadBuilder.build(store: store,
                                     device: DeviceInfo(id: "debug", name: "debug", os: "macOS", agentVersion: ArenaEngine.version))
print("\nscan took \(String(format: "%.1f", elapsed)) s; dirty minutes: \(try store.dirtyMinutes(limit: 100_000).count)")

struct Totals { var sec = 0; var tokensOut: Int64 = 0; var tokensIn: Int64 = 0; var cached: Int64 = 0; var maxSessions = 0 }
var totals: [String: Totals] = [:]
for t in try store.dirtyMinutes(limit: 100_000) {
    for entry in try store.agentEntries(t: t) {
        var total = totals[entry.agent, default: Totals()]
        total.sec += entry.sec
        total.tokensOut += entry.tokensOut
        total.tokensIn += entry.tokensIn
        total.cached += entry.tokensCached
        total.maxSessions = max(total.maxSessions, entry.sessions)
        totals[entry.agent] = total
    }
}

var chatsByAgent: [String: Int] = [:]
for chat in built.payload.chats ?? [] { chatsByAgent[chat.agent, default: 0] += 1 }

print("\nlast 7 days:")
print("agent      agent-hours  chats  peak-parallel  tokens-out  tokens-in  cached")
for (agent, t) in totals.sorted(by: { $0.key < $1.key }) {
    print(String(format: "%-10@ %11.1f  %5d  %13d  %10lld  %9lld  %lld", agent as NSString,
                 Double(t.sec) / 3600, chatsByAgent[agent] ?? 0, t.maxSessions, t.tokensOut, t.tokensIn, t.cached))
}

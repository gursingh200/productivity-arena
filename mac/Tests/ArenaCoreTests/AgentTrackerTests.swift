import Foundation
import Testing
@testable import ArenaCore

struct AgentTrackerTests {

    let claudeTurn = [
        ClaudeLine.human("2026-10-05T10:00:00Z"),
        ClaudeLine.assistant("2026-10-05T10:00:10Z", id: "m1", out: 40),
        ClaudeLine.toolResult("2026-10-05T10:01:10Z"),
        ClaudeLine.assistant("2026-10-05T10:01:30Z", id: "m2", out: 60),
        ClaudeLine.title("2026-10-05T10:05:00Z"),
        ClaudeLine.human("2026-10-05T10:20:00Z"),
        ClaudeLine.assistant("2026-10-05T10:20:15Z", id: "m3", out: 10),
    ]

    func totalSeconds(_ store: Store) throws -> Double {
        try store.agentSeconds(from: 0, to: minuteOf(testNow))
    }

    @Test func processesAClaudeSession() throws {
        let box = try Sandbox()
        let path = try box.write(".claude/projects/p/s1.jsonl", claudeTurn.map { $0 + "\n" }.joined())
        try box.tracker().processFile(path, source: ClaudeSource())
        #expect(try totalSeconds(box.store) == 105)  // 90 s first turn + 15 s second
        let chat = try #require(try box.store.chatSummary(agent: "claude", session: "s1"))
        #expect(chat.turns == 2)
        #expect(chat.tokens.output == 110)
    }

    @Test func incrementalReadsMatchAFullRead() throws {
        let full = try Sandbox()
        let fullPath = try full.write(".claude/projects/p/s1.jsonl", claudeTurn.map { $0 + "\n" }.joined())
        try full.tracker().processFile(fullPath, source: ClaudeSource())

        let parts = try Sandbox()
        let path = try parts.write(".claude/projects/p/s1.jsonl", "")
        let tracker = parts.tracker()
        for item in claudeTurn {
            // Write each line in two pieces to exercise partial trailing lines.
            let half = item.index(item.startIndex, offsetBy: item.count / 2)
            try parts.append(path, String(item[..<half]))
            try tracker.processFile(path, source: ClaudeSource())
            try parts.append(path, String(item[half...]) + "\n")
            try tracker.processFile(path, source: ClaudeSource())
        }
        #expect(try parts.store.sessionMinutes(agent: "claude", session: "s1", from: 0)
                == full.store.sessionMinutes(agent: "claude", session: "s1", from: 0))
        #expect(try parts.store.chatSummary(agent: "claude", session: "s1") == full.store.chatSummary(agent: "claude", session: "s1"))
    }

    @Test func streamedLinesForOneMessageCountTokensOnce() throws {
        let box = try Sandbox()
        let path = try box.write(".claude/projects/p/s1.jsonl", lines(
            ClaudeLine.human("2026-10-05T10:00:00Z"),
            ClaudeLine.assistant("2026-10-05T10:00:05Z", id: "m1", out: 3),
            ClaudeLine.assistant("2026-10-05T10:00:06Z", id: "m1", out: 3),
            ClaudeLine.assistant("2026-10-05T10:00:09Z", id: "m1", out: 120)))
        try box.tracker().processFile(path, source: ClaudeSource())
        let chat = try #require(try box.store.chatSummary(agent: "claude", session: "s1"))
        #expect(chat.tokens.output == 120)
        #expect(chat.agentSec == 9)
    }

    @Test func repeatedCodexTokenCountsCollapse() throws {
        let box = try Sandbox()
        let path = try box.write(".codex/sessions/2026/10/05/rollout-2026-10-05T10-00-00-01a0f15b-d449-7050-bc37-d840f6b83ca2.jsonl", lines(
            CodexLine.taskStarted("2026-10-05T10:00:00Z"),
            CodexLine.developerMessage("2026-10-05T10:00:00Z"),
            CodexLine.reasoning("2026-10-05T10:00:04Z"),
            CodexLine.tokenCount("2026-10-05T10:00:05Z", total: 1000, input: 900, cached: 400, out: 100),
            CodexLine.tokenCount("2026-10-05T10:00:05Z", total: 1000, input: 900, cached: 400, out: 100),
            CodexLine.toolCall("2026-10-05T10:00:30Z"),
            CodexLine.taskComplete("2026-10-05T10:00:45Z"),
            CodexLine.taskStarted("2026-10-05T10:09:00Z")))
        try box.tracker().processFile(path, source: CodexSource())
        let chat = try #require(try box.store.chatSummary(agent: "codex", session: "01a0f15b-d449-7050-bc37-d840f6b83ca2"))
        #expect(chat.tokens == TokenUsage(input: 500, cached: 400, output: 100))
        #expect(chat.agentSec == 45)
    }

    @Test func parallelSessionsAddUp() throws {
        let box = try Sandbox()
        let tracker = box.tracker()
        for session in ["a", "b", "c"] {
            let path = try box.write(".claude/projects/p/\(session).jsonl", lines(
                ClaudeLine.human("2026-10-05T10:00:00Z"),
                ClaudeLine.assistant("2026-10-05T10:00:30Z", id: "\(session)1", out: 5),
                ClaudeLine.toolResult("2026-10-05T10:00:50Z")))
            try tracker.processFile(path, source: ClaudeSource())
        }
        let entry = try #require(try box.store.agentEntries(t: minuteOf(at("2026-10-05T10:00:00Z"))).first)
        #expect(entry.sec == 150)
        #expect(entry.sessions == 3)
        #expect(entry.peak == 3)
        #expect(entry.tokensOut == 15)
    }

    @Test func truncatedFileIsReadAgainWithoutDoubleCounting() throws {
        let box = try Sandbox()
        let tracker = box.tracker()
        let path = try box.write(".claude/projects/p/s1.jsonl", claudeTurn.map { $0 + "\n" }.joined())
        try tracker.processFile(path, source: ClaudeSource())
        try FileManager.default.removeItem(atPath: path)
        _ = try box.write(".claude/projects/p/s1.jsonl", lines(claudeTurn[0], claudeTurn[1]))
        try tracker.processFile(path, source: ClaudeSource())
        #expect(try totalSeconds(box.store) == 105)
    }

    @Test func filesOlderThanTheLookbackAreSkipped() throws {
        let box = try Sandbox()
        let old = lines(ClaudeLine.human("2026-09-01T10:00:00Z"), ClaudeLine.assistant("2026-09-01T10:00:10Z", id: "x", out: 5))
        let path = try box.write(".claude/projects/p/old.jsonl", old)
        try box.setModified(path, at("2026-09-01T10:00:10Z"))
        try box.tracker().processFile(path, source: ClaudeSource())
        #expect(try box.store.firstEvent(agent: "claude", session: "old") == nil)
        #expect(try box.store.fileCursor(path: path)?.offset == Int64(old.utf8.count))
    }

    @Test func recomputeMarksChangedMinutesDirty() throws {
        let box = try Sandbox()
        let path = try box.write(".claude/projects/p/s1.jsonl", lines(claudeTurn[0], claudeTurn[1]))
        try box.tracker().processFile(path, source: ClaudeSource())
        #expect(try box.store.dirtyMinutes(limit: 10) == [minuteOf(at("2026-10-05T10:00:00Z"))])
        #expect(try box.store.dirtyChats(limit: 10).map(\.session) == ["s1"])
    }

    @Test func findsSourceForChangedPath() throws {
        let box = try Sandbox()
        let path = try box.write(".claude/projects/p/s1.jsonl", "")
        #expect(box.tracker().source(forFile: path)?.agent == "claude")
        #expect(box.tracker().source(forFile: box.dir + "/elsewhere/s1.jsonl") == nil)
    }

    @Test func busyProcessesGetAFullMinute() throws {
        let box = try Sandbox()
        let t = minuteOf(at("2026-10-05T10:00:00Z"))
        try box.tracker().recordBusyProcesses(["gemini"], minute: t)
        #expect(try box.store.agentEntries(t: t) == [AgentEntry(agent: "gemini", sec: 60, sessions: 1, peak: 1, tokensIn: 0, tokensCached: 0, tokensOut: 0, workSec: 60, threads: 1)])
    }
}

struct DatabaseSourceTests {

    @Test func readsCursorBubbles() throws {
        let box = try Sandbox()
        let dbPath = box.dir + "/state.vscdb"
        let store = try Store(path: dbPath)  // any SQLite file works for building a fixture
        _ = store
        try runSQL(dbPath, """
            CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);
            INSERT INTO cursorDiskKV VALUES('bubbleId:c1:b1', '{"type":1,"createdAt":"2026-10-05T10:00:00.000Z","tokenCount":{"inputTokens":0,"outputTokens":0}}');
            INSERT INTO cursorDiskKV VALUES('bubbleId:c1:b2', '{"type":2,"createdAt":"2026-10-05T10:00:20.000Z","tokenCount":{"inputTokens":0,"outputTokens":0}}');
            INSERT INTO cursorDiskKV VALUES('bubbleId:c1:b3', '{"type":2,"createdAt":"2026-09-01T10:00:20.000Z"}');
            INSERT INTO cursorDiskKV VALUES('composerData:c1', '{"x":1}');
            """)
        let sessions = try #require(CursorSource().read(databasePath: dbPath, since: at("2026-09-28T00:00:00Z")))
        #expect(sessions["c1"]?.map(\.kind) == [.human, .agent])
    }

    @Test func readsOpenCodeIncrementally() throws {
        let box = try Sandbox()
        let dbPath = box.dir + "/opencode.db"
        try runSQL(dbPath, """
            CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
            INSERT INTO message VALUES('u1','s1',1789384800000,1789384800000,'{"role":"user","time":{"created":1789384800000}}');
            INSERT INTO message VALUES('a1','s1',1789384801000,1789384830000,'{"role":"assistant","time":{"created":1789384801000,"completed":1789384830000},"tokens":{"input":1,"output":9,"reasoning":0,"cache":{"read":0,"write":0}}}');
            """)
        let source = OpenCodeSource()
        let first = try #require(source.read(databasePath: dbPath, watermark: 0))
        #expect(first.sessions["s1"]?.count == 3)
        #expect(first.newWatermark == 1789384830000)
        let second = try #require(source.read(databasePath: dbPath, watermark: first.newWatermark))
        #expect(second.sessions.isEmpty)
    }

    // MARK: - Sub-agents

    let parentLines = [
        ClaudeLine.human("2026-10-05T10:00:00Z"),
        ClaudeLine.assistant("2026-10-05T10:00:10Z", id: "p1", out: 20),
        ClaudeLine.toolResult("2026-10-05T10:03:00Z"),  // the Task tool returns when the sub-agent is done
        ClaudeLine.assistant("2026-10-05T10:03:20Z", id: "p2", out: 30),
    ]
    let subagentLines = [
        ClaudeLine.sidechainPrompt("2026-10-05T10:00:15Z"),
        ClaudeLine.assistant("2026-10-05T10:00:40Z", id: "s1", out: 50),
        ClaudeLine.toolResult("2026-10-05T10:01:40Z"),
        ClaudeLine.assistant("2026-10-05T10:02:50Z", id: "s2", out: 70),
    ]

    @Test func subagentTimeCountsOnceInOneSession() throws {
        let box = try Sandbox()
        let tracker = box.tracker()
        let parent = try box.write(".claude/projects/p/abc.jsonl", parentLines.map { $0 + "\n" }.joined())
        let sub = try box.write(".claude/projects/p/abc/subagents/agent-1.jsonl", subagentLines.map { $0 + "\n" }.joined())
        try tracker.processFile(parent, source: ClaudeSource())
        try tracker.processFile(sub, source: ClaudeSource())
        for t in stride(from: minuteOf(at("2026-10-05T10:00:00Z")), through: minuteOf(at("2026-10-05T10:03:00Z")), by: 60) {
            for entry in try box.store.agentEntries(t: t) { #expect(entry.sessions == 1 && entry.sec <= 60) }
        }
        let chat = try #require(try box.store.chatSummary(agent: "claude", session: "abc"))
        #expect(chat.tokens.output == 170)
        #expect(chat.turns == 1)  // the sub-agent's prompt is not a human turn
        // Continuous work from 10:00:00 to 10:03:20, counted once.
        #expect(try box.store.agentSeconds(from: 0, to: minuteOf(testNow)) == 200)
        #expect(try box.store.chatSummary(agent: "claude", session: "abc/agent-1") == nil)
    }

    /// Stores data the way version 1 did: the sub-agent under its own `<parent>/<stem>` session.
    func versionOneStore() throws -> Sandbox {
        let box = try Sandbox()
        let tracker = box.tracker()
        let source = ClaudeSource()
        try tracker.ingest(agent: "claude", session: "abc", events: parentLines.flatMap { source.events(fromLine: line($0)) },
                           requireTokens: true)
        // Version 1 also read the sub-agent's prompt as a human event.
        var subEvents = subagentLines.flatMap { source.events(fromLine: line($0)) }
        subEvents[0].kind = .human
        try tracker.ingest(agent: "claude", session: "abc/agent-1", events: subEvents, requireTokens: true)
        try box.store.setValue(nil, for: AgentTracker.subagentMergeKey)
        return box
    }

    @Test func migrationMatchesAFreshReadOfMergedLogs() throws {
        let old = try versionOneStore()
        #expect(try old.store.agentEntries(t: minuteOf(at("2026-10-05T10:01:00Z"))).first?.sessions == 2)
        let minutesBefore = Set(try old.store.dirtyMinutes(limit: 100))
        try old.store.clearDirtyMinutes(Array(minutesBefore))
        try old.store.clearDirtyChats(try old.store.dirtyChats(limit: 100))

        try old.tracker().mergeClaudeSubagents()

        let fresh = try Sandbox()
        let tracker = fresh.tracker()
        try tracker.processFile(try fresh.write(".claude/projects/p/abc.jsonl", parentLines.map { $0 + "\n" }.joined()), source: ClaudeSource())
        try tracker.processFile(try fresh.write(".claude/projects/p/abc/subagents/agent-1.jsonl",
                                                subagentLines.map { $0 + "\n" }.joined()), source: ClaudeSource())

        #expect(try old.store.sessionMinutes(agent: "claude", session: "abc", from: 0)
                == fresh.store.sessionMinutes(agent: "claude", session: "abc", from: 0))
        #expect(try old.store.chatSummary(agent: "claude", session: "abc") == fresh.store.chatSummary(agent: "claude", session: "abc"))
        #expect(try old.store.claudeSubagentSessions().isEmpty)
        #expect(try old.store.agentEntries(t: minuteOf(at("2026-10-05T10:01:00Z"))).first?.sessions == 1)
        // Every minute the sub-agent had is re-sent, and the parent chat is re-sent.
        #expect(Set(try old.store.dirtyMinutes(limit: 100)).isSuperset(of: minutesBefore))
        #expect(try old.store.dirtyChats(limit: 10).map(\.session) == ["abc"])

        // The old sub-agent chat is deleted on the server once, then forgotten.
        let device = DeviceInfo(id: "d", name: "Mac", os: "macOS", agentVersion: "0.1.0")
        let built = try PayloadBuilder.build(store: old.store, device: device)
        #expect(built.payload.deletedChats == [chatId(agent: "claude", sessionId: "abc/agent-1")])
        try old.store.clearDeletedChats(built.deletedChats)
        #expect(try PayloadBuilder.build(store: old.store, device: device).payload.deletedChats == nil)

        // Runs once.
        try old.store.addDeletedChat("x")
        try old.tracker().mergeClaudeSubagents()
        #expect(try old.store.deletedChats(limit: 10) == ["x"])
    }

    @Test func migrationResumesTheRecomputeAfterACrash() throws {
        // Simulate a crash right after the merge transaction: events moved, parent queued, no recompute yet.
        let old = try versionOneStore()
        try old.store.transaction {
            _ = try old.store.mergeSession(agent: "claude", session: "abc/agent-1", into: "abc")
            try old.store.setValue("abc", for: AgentTracker.subagentPendingKey)
        }
        try old.tracker().mergeClaudeSubagents()

        let fresh = try Sandbox()
        let tracker = fresh.tracker()
        try tracker.processFile(try fresh.write(".claude/projects/p/abc.jsonl", parentLines.map { $0 + "\n" }.joined()), source: ClaudeSource())
        try tracker.processFile(try fresh.write(".claude/projects/p/abc/subagents/agent-1.jsonl",
                                                subagentLines.map { $0 + "\n" }.joined()), source: ClaudeSource())
        #expect(try old.store.sessionMinutes(agent: "claude", session: "abc", from: 0)
                == fresh.store.sessionMinutes(agent: "claude", session: "abc", from: 0))
        #expect(try old.store.value(AgentTracker.subagentPendingKey) == nil)
    }
}

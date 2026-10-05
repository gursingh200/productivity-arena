import Foundation
import Testing
@testable import ArenaCore

struct ClaudeParsingTests {
    let source = ClaudeSource()

    @Test func classifiesLines() {
        #expect(source.events(fromLine: line(ClaudeLine.human("2026-10-05T10:00:00.000Z"))).first?.kind == .human)
        #expect(source.events(fromLine: line(ClaudeLine.toolResult("2026-10-05T10:00:01Z"))).first?.kind == .agent)
        #expect(source.events(fromLine: line(ClaudeLine.meta("2026-10-05T10:00:02Z"))).isEmpty)
        #expect(source.events(fromLine: line(ClaudeLine.title("2026-10-05T10:00:03Z"))).isEmpty)
        #expect(source.events(fromLine: line("not json")).isEmpty)
    }

    @Test func subagentPromptsAreAgentEvents() {
        #expect(source.events(fromLine: line(ClaudeLine.sidechainPrompt("2026-10-05T10:00:00Z"))).first?.kind == .agent)
    }

    @Test func backgroundWakeupsAreAgentEvents() {
        let wake = #"{"type":"user","timestamp":"2026-10-05T10:00:00Z","origin":{"kind":"task-notification"},"message":{"role":"user","content":"done"}}"#
        #expect(source.events(fromLine: line(wake)).first?.kind == .agent)
    }

    @Test func readsTokensKeyedByMessageId() {
        let e = source.events(fromLine: line(ClaudeLine.assistant("2026-10-05T10:00:00Z", id: "msg_1", out: 187)))
        #expect(e.first?.tokens == TokenUsage(input: 53, cached: 900, output: 187))
        #expect(e.first?.tokenKey == "msg_1")
    }

    @Test func subagentFilesBelongToTheirParentSession() {
        #expect(source.sessionId(forFile: "/x/proj/abc.jsonl") == "abc")
        #expect(source.sessionId(forFile: "/x/proj/abc/subagents/agent-1.jsonl") == "abc")
    }
}

struct CodexParsingTests {
    let source = CodexSource()

    @Test func classifiesLines() {
        #expect(source.events(fromLine: line(CodexLine.taskStarted("2026-10-05T10:00:00Z"))).first?.kind == .human)
        #expect(source.events(fromLine: line(CodexLine.developerMessage("2026-10-05T10:00:00Z"))).isEmpty)
        #expect(source.events(fromLine: line(CodexLine.reasoning("2026-10-05T10:00:01Z"))).first?.kind == .agent)
        #expect(source.events(fromLine: line(CodexLine.toolCall("2026-10-05T10:00:02Z"))).first?.kind == .agent)
        #expect(source.events(fromLine: line(CodexLine.taskComplete("2026-10-05T10:00:03Z"))).first?.kind == .agent)
        let meta = #"{"timestamp":"2026-10-05T10:00:00Z","type":"session_meta","payload":{"id":"x"}}"#
        #expect(source.events(fromLine: line(meta)).isEmpty)
    }

    @Test func tokenCountSplitsCachedInput() {
        let e = source.events(fromLine: line(CodexLine.tokenCount("2026-10-05T10:00:00Z", total: 18490, input: 18362, cached: 6912, out: 128)))
        #expect(e.first?.tokens == TokenUsage(input: 11450, cached: 6912, output: 128))
        #expect(e.first?.tokenKey == "total:18490")
    }

    @Test func tokenCountWithoutInfoIsStillActivity() {
        let e = source.events(fromLine: line(#"{"timestamp":"2026-10-05T10:00:00Z","type":"event_msg","payload":{"type":"token_count","info":null}}"#))
        #expect(e.first?.kind == .agent)
        #expect(e.first?.tokens == nil)
    }

    @Test func sessionIdIsTheUuidSuffix() {
        let path = "/s/2026/09/30/rollout-2026-09-30T13-38-42-01a0f15b-d449-7050-bc37-d840f6b83ca2.jsonl"
        #expect(source.sessionId(forFile: path) == "01a0f15b-d449-7050-bc37-d840f6b83ca2")
        #expect(source.isSessionFile(path))
        #expect(!source.isSessionFile("/s/other.jsonl"))
    }
}

struct PiParsingTests {
    @Test func classifiesLinesAndTokens() {
        let source = PiSource()
        let user = #"{"type":"message","id":"a","timestamp":"2026-10-05T10:00:00Z","message":{"role":"user","content":"hi"}}"#
        let reply = #"{"type":"message","id":"b","timestamp":"2026-10-05T10:00:05Z","message":{"role":"assistant","usage":{"input":10,"output":20,"cacheRead":30,"cacheWrite":5}}}"#
        let tool = #"{"type":"message","id":"c","timestamp":"2026-10-05T10:00:06Z","message":{"role":"toolResult"}}"#
        #expect(source.events(fromLine: line(user)).first?.kind == .human)
        let e = source.events(fromLine: line(reply)).first
        #expect(e?.tokens == TokenUsage(input: 15, cached: 30, output: 20))
        #expect(e?.tokenKey == "b")
        #expect(source.events(fromLine: line(tool)).first?.kind == .agent)
        #expect(source.events(fromLine: line(#"{"type":"session","timestamp":"2026-10-05T10:00:00Z"}"#)).isEmpty)
    }
}

struct OpenCodeParsingTests {
    @Test func assistantMessageEmitsStartAndEnd() {
        let json = #"{"role":"assistant","time":{"created":1789384823980,"completed":1789384830363},"tokens":{"input":5587,"output":82,"reasoning":4,"cache":{"read":55040,"write":7}}}"#
        let e = OpenCodeSource().events(messageId: "msg_1", json: line(json))
        #expect(e.count == 2)
        #expect(e[0].tokens == TokenUsage(input: 5594, cached: 55040, output: 86))
        #expect(e[1].timestamp.timeIntervalSince(e[0].timestamp) > 6.3)
    }

    @Test func userMessageIsHuman() {
        let e = OpenCodeSource().events(messageId: "m", json: line(#"{"role":"user","time":{"created":1789384823980}}"#))
        #expect(e.first?.kind == .human)
    }
}

struct ProcessMatcherTests {
    @Test func matchesNativeAndScriptAgents() {
        #expect(AgentProcessMatcher.agent(executable: "droid", arguments: []) == "droid")
        #expect(AgentProcessMatcher.agent(executable: "node", arguments: ["node", "/opt/homebrew/lib/node_modules/@google/gemini-cli/dist/index.js"]) == "gemini")
        #expect(AgentProcessMatcher.agent(executable: "node", arguments: ["node", "/usr/local/bin/amp"]) == "amp")
        #expect(AgentProcessMatcher.agent(executable: "node", arguments: ["node", "server.js"]) == nil)
        #expect(AgentProcessMatcher.agent(executable: "campfire", arguments: []) == nil)
        #expect(AgentProcessMatcher.agent(executable: "ampd", arguments: []) == nil)
    }
}

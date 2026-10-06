import Foundation
import Testing
@testable import ArenaCore

struct SessionTimelineTests {

    func seconds(_ events: [AgentEvent], requireTokens: Bool = true, clip: Date? = nil) -> SessionTimeline.Result {
        SessionTimeline.compute(events: events, tokens: tokenRecords(events), requireTokens: requireTokens, clipFrom: clip)
    }

    @Test func countsFromPromptToLastAgentEvent() {
        let r = seconds([human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:10Z", out: 50), agent("2026-10-05T10:00:40Z")])
        #expect(r.totalSeconds == 40)
    }

    @Test func waitingOnTheHumanIsNotCounted() {
        let r = seconds([
            human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:30Z", out: 5),
            human("2026-10-05T10:04:00Z"), agent("2026-10-05T10:04:20Z", out: 5),
        ])
        #expect(r.totalSeconds == 50)
    }

    @Test func longToolRunInsideATokenSpendingTurnCounts() {
        let r = seconds([human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:05Z", out: 20), agent("2026-10-05T10:08:05Z")])
        #expect(r.totalSeconds == 485)
    }

    @Test func gapsOverTenMinutesAreNotCounted() {
        let r = seconds([human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:05Z", out: 20), agent("2026-10-05T10:11:00Z")])
        // 5 s for the first pair; the later event is isolated and counts 5 s.
        #expect(r.totalSeconds == 10)
    }

    @Test func turnsWithoutOutputTokensAreDropped() {
        let events = [human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:30Z", out: 0), agent("2026-10-05T10:01:00Z")]
        #expect(seconds(events).totalSeconds == 0)
        #expect(seconds(events, requireTokens: false).totalSeconds == 60)
    }

    @Test func onlyTheTurnWithEvidenceCounts() {
        let r = seconds([
            human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:30Z"),            // no tokens: dropped
            human("2026-10-05T10:02:00Z"), agent("2026-10-05T10:02:20Z", out: 9),    // counted
        ])
        #expect(r.totalSeconds == 20)
    }

    @Test func isolatedAgentEventCountsFiveSeconds() {
        let r = seconds([agent("2026-10-05T10:00:00Z")], requireTokens: false)
        #expect(r.totalSeconds == 5)
    }

    @Test func splitsAcrossMinuteBoundaries() {
        let r = seconds([human("2026-10-05T10:00:50Z"), agent("2026-10-05T10:01:20Z", out: 1)])
        let t = minuteOf(at("2026-10-05T10:00:00Z"))
        #expect(r.secondsByMinute[t] == 10)
        #expect(r.secondsByMinute[t + 60] == 20)
    }

    @Test func clipDropsEarlierTime() {
        let r = seconds([human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:02:00Z", out: 1)],
                        clip: at("2026-10-05T10:01:00Z"))
        #expect(r.totalSeconds == 60)
    }

    @Test func unsortedInputIsSorted() {
        let r = seconds([agent("2026-10-05T10:00:40Z"), human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:00:10Z", out: 1)])
        #expect(r.totalSeconds == 40)
    }
}

@Suite struct ThreadedTimelineTests {
    func sub(_ iso: String, _ thread: String) -> AgentEvent { AgentEvent(timestamp: at(iso), kind: .agent, thread: thread) }

    @Test func subagentsInParallelAddUpButTheClockCountsOnce() {
        // The main thread hands off at 10:00 and hears back at 10:20; two sub-agents work 10:00–10:20 at once.
        var events = [human("2026-10-05T09:59:00Z"), agent("2026-10-05T10:00:00Z"), agent("2026-10-05T10:20:00Z")]
        for thread in ["a", "b"] {
            for minute in stride(from: 0, through: 20, by: 5) {
                events.append(sub(String(format: "2026-10-05T10:%02d:00Z", minute), thread))
            }
        }
        let r = SessionTimeline.computeThreaded(events: events, tokens: [], requireTokens: false)
        let clock = r.clock.totalSeconds
        let work = r.work.values.reduce(0, +)
        #expect(abs(clock - 21 * 60) < 61) // 09:59 to 10:20
        #expect(abs(work - 2 * 20 * 60) < 121) // two sub-agents for 20 minutes each; the waiting main thread adds ~nothing
        #expect(r.threads[minuteOf(at("2026-10-05T10:10:00Z"))] == 2)
    }

    @Test func withoutSubagentsTotalEqualsClock() {
        let events = [human("2026-10-05T10:00:00Z"), agent("2026-10-05T10:01:00Z"), agent("2026-10-05T10:04:00Z")]
        let r = SessionTimeline.computeThreaded(events: events, tokens: [], requireTokens: false)
        #expect(r.work == r.clock.secondsByMinute)
        #expect(Set(r.threads.values) == [1])
    }
}

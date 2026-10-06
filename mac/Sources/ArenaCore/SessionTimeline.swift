import Foundation

/// Turns one session's events into working seconds per minute. Spec §1.3.
///
/// Rules:
/// - Events are sorted by time. A *turn* starts at each human event; events
///   before the first human event belong to a leading turn.
/// - For consecutive events (a, b) the agent was working during [a, b] if
///   b is an agent event and b - a ≤ 10 min. A gap that ends in a human event
///   is the agent waiting on the human, so it never counts.
/// - An agent event that is not part of any counted pair counts for 5 s.
/// - Token evidence: when `requireTokens` is true, a turn only counts if its
///   token records have output > 0 (the model actually ran).
/// - `clipFrom` drops any working time before that instant, so a caller can
///   recompute only the tail of a session.
public enum SessionTimeline {

    public static let maxGap: TimeInterval = 10 * 60
    public static let isolatedEventSeconds: TimeInterval = 5

    public struct Result: Equatable {
        public var secondsByMinute: [MinuteT: Double]

        public var totalSeconds: Double { secondsByMinute.values.reduce(0, +) }
    }

    /// Clock time plus total time: each thread of the session (the main one
    /// and every sub-agent) is timed on its own and the results are added up,
    /// never less than the clock time. `threads` counts the threads that
    /// worked in each minute.
    public struct Threaded: Equatable {
        public var clock: Result
        public var work: [MinuteT: Double]
        public var threads: [MinuteT: Int]
    }

    public static func computeThreaded(
        events: [AgentEvent],
        tokens: [TokenRecord],
        requireTokens: Bool,
        clipFrom: Date? = nil
    ) -> Threaded {
        let clock = compute(events: events, tokens: tokens, requireTokens: requireTokens, clipFrom: clipFrom)
        var work: [MinuteT: Double] = [:]
        var threads: [MinuteT: Int] = [:]
        for (thread, threadEvents) in Dictionary(grouping: events, by: \.thread) {
            // Sub-agents have no human turns of their own; their events are the evidence.
            let result = thread.isEmpty
                ? compute(events: threadEvents, tokens: tokens, requireTokens: requireTokens, clipFrom: clipFrom)
                : compute(events: threadEvents, tokens: [], requireTokens: false, clipFrom: clipFrom)
            for (t, sec) in result.secondsByMinute where sec > 0 {
                work[t, default: 0] += sec
                threads[t, default: 0] += 1
            }
        }
        for (t, sec) in clock.secondsByMinute {
            work[t] = max(work[t] ?? 0, sec)
            threads[t] = max(threads[t] ?? 0, 1)
        }
        return Threaded(clock: clock, work: work.filter { clock.secondsByMinute[$0.key] != nil }, threads: threads)
    }

    public static func compute(
        events unsorted: [AgentEvent],
        tokens: [TokenRecord],
        requireTokens: Bool,
        clipFrom: Date? = nil
    ) -> Result {
        let events = unsorted.sorted { $0.timestamp < $1.timestamp }
        guard !events.isEmpty else { return Result(secondsByMinute: [:]) }

        let humanTimes = events.filter { $0.kind == .human }.map(\.timestamp)
        let countedTurns = turnsWithEvidence(humanTimes: humanTimes, tokens: tokens, requireTokens: requireTokens)

        var intervals: [(start: Date, end: Date)] = []
        var partOfPair = [Bool](repeating: false, count: events.count)

        for i in events.indices.dropFirst() {
            let a = events[i - 1]
            let b = events[i]
            let gap = b.timestamp.timeIntervalSince(a.timestamp)
            guard b.kind == .agent, gap > 0, gap <= maxGap else { continue }
            guard countedTurns.contains(turnIndex(of: b.timestamp, humanTimes: humanTimes)) else { continue }
            intervals.append((a.timestamp, b.timestamp))
            partOfPair[i - 1] = true
            partOfPair[i] = true
        }

        for (i, event) in events.enumerated() where event.kind == .agent && !partOfPair[i] {
            guard countedTurns.contains(turnIndex(of: event.timestamp, humanTimes: humanTimes)) else { continue }
            intervals.append((event.timestamp, event.timestamp.addingTimeInterval(isolatedEventSeconds)))
        }

        var seconds: [MinuteT: Double] = [:]
        for interval in intervals {
            var start = interval.start
            if let clip = clipFrom, start < clip { start = clip }
            for (t, sec) in splitAcrossMinutes(start: start, end: interval.end) {
                seconds[t, default: 0] += sec
            }
        }
        return Result(secondsByMinute: seconds)
    }

    /// Index of the turn an instant belongs to: the number of human events at
    /// or before it. 0 is the leading turn before any human event.
    static func turnIndex(of time: Date, humanTimes: [Date]) -> Int {
        var low = 0
        var high = humanTimes.count
        while low < high {
            let mid = (low + high) / 2
            if humanTimes[mid] <= time { low = mid + 1 } else { high = mid }
        }
        return low
    }

    private static func turnsWithEvidence(humanTimes: [Date], tokens: [TokenRecord], requireTokens: Bool) -> Set<Int> {
        let allTurns = Set(0...humanTimes.count)
        guard requireTokens else { return allTurns }
        var counted = Set<Int>()
        for record in tokens where record.usage.output > 0 {
            counted.insert(turnIndex(of: record.timestamp, humanTimes: humanTimes))
        }
        return counted
    }

    /// Splits [start, end) across minute boundaries.
    public static func splitAcrossMinutes(start: Date, end: Date) -> [(MinuteT, Double)] {
        var result: [(MinuteT, Double)] = []
        var cursor = start
        while cursor < end {
            let t = minuteOf(cursor)
            let minuteEnd = dateOfMinute(t + 60)
            let sliceEnd = min(end, minuteEnd)
            result.append((t, sliceEnd.timeIntervalSince(cursor)))
            cursor = sliceEnd
        }
        return result
    }
}

import Foundation

/// The three things the dashboard charts. Human time excludes call time in the
/// same minute (a call wins the minute, as on the server).
public enum ActivitySeries: String, CaseIterable, Sendable {
    case human, agents, meetings
}

/// Day / week / month ranges in local time. Weeks start on Monday, like the
/// leaderboard.
public enum ActivityRange: String, CaseIterable, Sendable {
    case day, week, month

    public func interval(containing date: Date, calendar: Calendar) -> DateInterval {
        var calendar = calendar
        calendar.firstWeekday = 2
        switch self {
        case .day:
            let start = calendar.startOfDay(for: date)
            return DateInterval(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!)
        case .week:
            return calendar.dateInterval(of: .weekOfYear, for: date)!
        case .month:
            return calendar.dateInterval(of: .month, for: date)!
        }
    }

    /// The same-sized range before (-1) or after (+1) `interval`.
    public func shifted(_ interval: DateInterval, by steps: Int, calendar: Calendar) -> DateInterval {
        let component: Calendar.Component = self == .day ? .day : self == .week ? .weekOfYear : .month
        let moved = calendar.date(byAdding: component, value: steps, to: interval.start)!
        return self.interval(containing: moved, calendar: calendar)
    }
}

/// Time for one app, call app or agent over a range.
public struct UsageItem: Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var seconds: Int
    /// Seconds per local hour of day, 0–23, summed over the range.
    public var hourly: [Int]
}

/// Everything the activity dashboard shows for one range, built from local data only.
public struct ActivityReport: Equatable, Sendable {
    public var interval: DateInterval
    /// Local start of each day in the range.
    public var days: [Date]
    public var totals: [ActivitySeries: Int]
    /// Seconds per local hour of day (24 entries), summed over the range.
    public var hourly: [ActivitySeries: [Int]]
    /// Seconds per day of the range.
    public var daily: [ActivitySeries: [Int]]
    /// Seconds per [day][hour].
    public var grid: [ActivitySeries: [[Int]]]
    public var apps: [UsageItem]
    public var meetingApps: [UsageItem]
    public var agents: [UsageItem]
    /// Most agent sessions working in one minute.
    public var peakParallel: Int

    /// Days of the range up to and including today (for daily averages).
    public func elapsedDays(now: Date) -> Int {
        max(1, days.filter { $0 <= now }.count)
    }

    public static func empty(interval: DateInterval, calendar: Calendar) -> ActivityReport {
        let days = dayStarts(interval, calendar: calendar)
        let zero24 = Array(repeating: 0, count: 24)
        var report = ActivityReport(interval: interval, days: days, totals: [:], hourly: [:], daily: [:], grid: [:],
                                    apps: [], meetingApps: [], agents: [], peakParallel: 0)
        for series in ActivitySeries.allCases {
            report.totals[series] = 0
            report.hourly[series] = zero24
            report.daily[series] = Array(repeating: 0, count: days.count)
            report.grid[series] = Array(repeating: zero24, count: days.count)
        }
        return report
    }

    public static func build(store: Store, interval: DateInterval, calendar: Calendar) throws -> ActivityReport {
        let from = minuteOf(interval.start)
        let to = minuteOf(interval.end)
        return build(active: try store.activeMinutes(from: from, to: to),
                     apps: try store.appMinutes(from: from, to: to),
                     meetings: try store.meetingMinutes(from: from, to: to),
                     agents: try store.agentMinutes(from: from, to: to),
                     interval: interval, calendar: calendar)
    }

    /// Pure aggregation, separated from the store for tests.
    public static func build(active: [MinuteT], apps: [Store.MinuteSeconds], meetings: [Store.MinuteSeconds],
                             agents: [Store.AgentMinute], interval: DateInterval, calendar: Calendar) -> ActivityReport {
        var report = empty(interval: interval, calendar: calendar)
        let dayIndex: [Date: Int] = Dictionary(uniqueKeysWithValues: report.days.enumerated().map { ($1, $0) })

        func add(_ series: ActivitySeries, _ t: MinuteT, _ sec: Int) {
            guard sec > 0, let (day, hour) = bucket(t) else { return }
            report.totals[series, default: 0] += sec
            report.hourly[series]![hour] += sec
            report.daily[series]![day] += sec
            report.grid[series]![day][hour] += sec
        }
        func bucket(_ t: MinuteT) -> (Int, Int)? {
            let date = dateOfMinute(t)
            guard let day = dayIndex[calendar.startOfDay(for: date)] else { return nil }
            return (day, calendar.component(.hour, from: date))
        }

        // Calls: at most 60 s a minute.
        var callByMinute: [MinuteT: Int] = [:]
        for m in meetings { callByMinute[m.t, default: 0] += m.sec }
        for (t, sec) in callByMinute { add(.meetings, t, min(60, sec)) }

        // Human: 60 s per active minute, minus call time in it.
        let activeSet = Set(active)
        for t in activeSet { add(.human, t, 60 - min(60, callByMinute[t] ?? 0)) }

        // Agents: summed over parallel sessions.
        var sessionsByMinute: [MinuteT: Int] = [:]
        for a in agents {
            add(.agents, a.t, Int(a.sec.rounded()))
            sessionsByMinute[a.t, default: 0] += a.sessions
        }
        report.peakParallel = sessionsByMinute.values.max() ?? 0

        // Apps: an active minute's shares scaled to 60 s, exactly as uploaded.
        var appsByMinute: [MinuteT: [AppEntry]] = [:]
        for a in apps where activeSet.contains(a.t) {
            appsByMinute[a.t, default: []].append(AppEntry(id: a.id, name: a.id == "private" ? "Private apps" : a.name, sec: a.sec))
        }
        var appItems: [String: UsageItem] = [:]
        for t in activeSet {
            for entry in PayloadBuilder.normalized(appsByMinute[t] ?? []) {
                accumulate(&appItems, id: entry.id, name: entry.name ?? entry.id, t: t, sec: entry.sec, bucket: bucket)
            }
        }
        report.apps = sorted(appItems)

        var callItems: [String: UsageItem] = [:]
        for m in meetings {
            accumulate(&callItems, id: m.id, name: m.id == "private" ? "Private apps" : m.name, t: m.t, sec: m.sec, bucket: bucket)
        }
        report.meetingApps = sorted(callItems)

        var agentItems: [String: UsageItem] = [:]
        for a in agents {
            accumulate(&agentItems, id: a.agent, name: agentDisplayName(a.agent), t: a.t, sec: Int(a.sec.rounded()), bucket: bucket)
        }
        report.agents = sorted(agentItems)
        return report
    }

    private static func accumulate(_ items: inout [String: UsageItem], id: String, name: String, t: MinuteT, sec: Int,
                                   bucket: (MinuteT) -> (Int, Int)?) {
        guard sec > 0, let (_, hour) = bucket(t) else { return }
        var item = items[id] ?? UsageItem(id: id, name: name, seconds: 0, hourly: Array(repeating: 0, count: 24))
        item.seconds += sec
        item.hourly[hour] += sec
        items[id] = item
    }

    private static func sorted(_ items: [String: UsageItem]) -> [UsageItem] {
        items.values.sorted { $0.seconds != $1.seconds ? $0.seconds > $1.seconds : $0.id < $1.id }
    }

    static func dayStarts(_ interval: DateInterval, calendar: Calendar) -> [Date] {
        var days: [Date] = []
        var day = calendar.startOfDay(for: interval.start)
        while day < interval.end {
            days.append(day)
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return days
    }
}

/// Display names for agent ids (matches the web app).
public func agentDisplayName(_ agent: String) -> String {
    let names = ["claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode", "pi": "Pi", "cursor": "Cursor",
                 "gemini": "Gemini CLI", "amp": "Amp", "droid": "Droid", "aider": "Aider", "goose": "Goose",
                 "crush": "Crush", "qwen": "Qwen Code", "cursor-agent": "Cursor CLI"]
    return names[agent] ?? agent
}

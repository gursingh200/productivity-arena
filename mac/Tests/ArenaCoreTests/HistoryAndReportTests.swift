import Foundation
import Testing
@testable import ArenaCore

@Suite struct HistoryRetentionTests {

    /// A two-turn session on 2026-08-01, well over 30 days before testNow.
    let oldEvents = [
        human("2026-08-01T09:00:00Z"),
        agent("2026-08-01T09:00:30Z", out: 40, key: "m1"),
        agent("2026-08-01T09:02:00Z"),
        human("2026-08-01T09:10:00Z"),
        agent("2026-08-01T09:11:00Z", out: 60, key: "m2"),
    ]
    let resumedEvents = [
        human("2026-10-05T10:00:00Z"),
        agent("2026-10-05T10:01:00Z", out: 25, key: "m3"),
        agent("2026-10-05T10:03:00Z"),
    ]

    /// Ingests events with "now" right after them, so the 7-day lookback keeps them.
    func ingest(_ box: Sandbox, _ events: [AgentEvent], now: Date) throws {
        let tracker = AgentTracker(store: box.store, paths: box.paths, now: { now })
        try tracker.ingest(agent: "claude", session: "s1", events: events, requireTokens: true)
    }

    @Test func foldingAQuietSessionKeepsItsChatSummaryAndMinutes() throws {
        let box = try Sandbox()
        try ingest(box, oldEvents, now: at("2026-08-01T12:00:00Z"))
        let before = try #require(try box.store.chatSummary(agent: "claude", session: "s1"))
        let minutesBefore = try box.store.sessionMinutes(agent: "claude", session: "s1", from: 0)

        try box.store.prune(now: testNow)

        #expect(try box.store.events(agent: "claude", session: "s1", from: .distantPast).isEmpty)
        #expect(try box.store.tokenRecords(agent: "claude", session: "s1", from: .distantPast).isEmpty)
        #expect(try box.store.chatSummary(agent: "claude", session: "s1") == before)
        #expect(try box.store.sessionMinutes(agent: "claude", session: "s1", from: 0) == minutesBefore)
    }

    @Test func aResumedSessionAfterFoldingMatchesOneThatWasNeverPruned() throws {
        let pruned = try Sandbox()
        try ingest(pruned, oldEvents, now: at("2026-08-01T12:00:00Z"))
        try pruned.store.prune(now: testNow)
        try ingest(pruned, resumedEvents, now: testNow)

        let kept = try Sandbox()
        try ingest(kept, oldEvents, now: at("2026-08-01T12:00:00Z"))
        try ingest(kept, resumedEvents, now: testNow)

        #expect(try pruned.store.chatSummary(agent: "claude", session: "s1") == kept.store.chatSummary(agent: "claude", session: "s1"))
        #expect(try pruned.store.sessionMinutes(agent: "claude", session: "s1", from: 0)
                == kept.store.sessionMinutes(agent: "claude", session: "s1", from: 0))
    }

    @Test func recentSessionsAreNotFolded() throws {
        let box = try Sandbox()
        try ingest(box, resumedEvents, now: testNow)
        try box.store.prune(now: testNow)
        #expect(try box.store.events(agent: "claude", session: "s1", from: .distantPast).count == resumedEvents.count)
        #expect(try box.store.chatBase(agent: "claude", session: "s1") == nil)
    }

    @Test func perMinuteHistoryIsKeptForeverByDefault() throws {
        let box = try Sandbox()
        let old = minuteOf(at("2025-01-01T10:00:00Z"))
        _ = try box.store.markActive(old)
        try box.store.addAppSeconds(t: old, bundleId: "com.apple.Terminal", appName: "Terminal", sec: 60)
        try box.store.prune(now: testNow)
        #expect(try box.store.isActive(old))
        #expect(try box.store.appSeconds(t: old).count == 1)
    }

    @Test func keepHistoryDeletesOlderMinutesAndTheirQueueEntries() throws {
        let box = try Sandbox()
        let old = minuteOf(at("2026-09-01T10:00:00Z"))   // 34 days before testNow
        let recent = minuteOf(at("2026-10-01T10:00:00Z"))
        for t in [old, recent] {
            _ = try box.store.markActive(t)
            try box.store.addMeetingSeconds(t: t, bundleId: "us.zoom.xos", appName: "zoom.us", sec: 30)
        }
        try box.store.prune(now: testNow, keepDays: 30)
        #expect(try !box.store.isActive(old))
        #expect(try box.store.meetingSeconds(t: old).isEmpty)
        #expect(try box.store.isActive(recent))
        #expect(try box.store.dirtyMinutes(limit: 10) == [recent])
    }

    @Test func deleteAllClearsHistoryAndTheUploadQueueButKeepsSettings() throws {
        let box = try Sandbox()
        try ingest(box, resumedEvents, now: testNow)
        _ = try box.store.markActive(minuteOf(testNow))
        try box.store.saveFileCursor(path: "/x.jsonl", cursor: Store.FileCursor(inode: 1, offset: 10))
        try box.store.setValue("https://arena.example", for: "settings.server")

        try box.store.deleteAllHistory()

        #expect(try box.store.dirtyMinutes(limit: 10).isEmpty)
        #expect(try box.store.dirtyChats(limit: 10).isEmpty)
        #expect(try box.store.chatSummary(agent: "claude", session: "s1") == nil)
        #expect(try box.store.activeMinuteCount(from: 0, to: minuteOf(testNow) + 60) == 0)
        #expect(try box.store.fileCursor(path: "/x.jsonl") != nil)
        #expect(try box.store.value("settings.server") == "https://arena.example")
    }
}

@Suite struct ActivityReportTests {

    /// India Standard Time (UTC+5:30), so hour and day buckets differ from UTC.
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Kolkata")!
        return c
    }

    @Test func bucketsByLocalHourAndLetsACallWinTheMinute() {
        // 2026-10-05 04:00Z = 09:30 IST; 04:31Z = 10:01 IST.
        let typing = minuteOf(at("2026-10-05T04:00:00Z"))
        let onCall = minuteOf(at("2026-10-05T04:31:00Z"))
        let day = ActivityRange.day.interval(containing: at("2026-10-05T06:00:00Z"), calendar: calendar)
        let report = ActivityReport.build(
            active: [typing, onCall],
            apps: [.init(t: typing, id: "com.apple.Terminal", name: "Terminal", sec: 30),
                   .init(t: typing, id: "com.google.Chrome", name: "Google Chrome", sec: 10),
                   .init(t: onCall, id: "us.zoom.xos", name: "zoom.us", sec: 20)],
            meetings: [.init(t: onCall, id: "us.zoom.xos", name: "zoom.us", sec: 45)],
            agents: [.init(t: typing, agent: "claude", sec: 90, sessions: 2)],
            interval: day, calendar: calendar)

        #expect(report.totals[.human] == 60 + 15)
        #expect(report.totals[.meetings] == 45)
        #expect(report.totals[.agents] == 90)
        #expect(report.hourly[.human]![9] == 60)
        #expect(report.hourly[.human]![10] == 15)
        #expect(report.hourly[.meetings]![10] == 45)
        #expect(report.peakParallel == 2)
        // App shares of an active minute are scaled to 60 s, as uploaded.
        #expect(report.apps.first { $0.id == "com.apple.Terminal" }?.seconds == 45)
        #expect(report.apps.first { $0.id == "com.google.Chrome" }?.seconds == 15)
        #expect(report.agents.first?.name == "Claude Code")
    }

    @Test func ignoresMinutesOutsideTheRangeAndSplitsDays() {
        let week = ActivityRange.week.interval(containing: at("2026-10-07T12:00:00Z"), calendar: calendar)
        #expect(week.start == at("2026-10-04T18:30:00Z"))   // Monday 00:00 IST
        #expect(ActivityRange.week.shifted(week, by: -1, calendar: calendar).end == week.start)
        let inside = minuteOf(at("2026-10-06T10:00:00Z"))
        let outside = minuteOf(at("2026-10-01T10:00:00Z"))
        let report = ActivityReport.build(active: [inside, outside], apps: [], meetings: [], agents: [],
                                          interval: week, calendar: calendar)
        #expect(report.days.count == 7)
        #expect(report.totals[.human] == 60)
        #expect(report.daily[.human]![1] == 60)   // Tuesday
        #expect(report.apps.first?.name == "Other")
        let month = ActivityRange.month.interval(containing: at("2026-10-07T12:00:00Z"), calendar: calendar)
        #expect(ActivityReport.empty(interval: month, calendar: calendar).days.count == 31)
    }
}

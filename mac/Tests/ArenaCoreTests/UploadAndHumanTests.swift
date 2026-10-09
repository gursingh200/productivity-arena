import Foundation
import Testing
@testable import ArenaCore

struct PayloadTests {
    let device = DeviceInfo(id: "dev-1", name: "Test Mac", os: "macOS 26.0", agentVersion: "0.1.0")

    @Test func encodesSpecFieldNames() throws {
        let box = try Sandbox()
        let t = minuteOf(at("2026-10-05T10:31:00Z"))
        try box.store.addAppSeconds(t: t, bundleId: "com.apple.Safari", appName: "Safari", sec: 30)
        try box.store.addAppSeconds(t: t, bundleId: "private", appName: "", sec: 18)
        try box.store.addMeetingSeconds(t: t, bundleId: "us.zoom.xos", appName: "Zoom", sec: 20)
        try box.store.markActive(t)
        let path = try box.write(".claude/projects/p/s1.jsonl", lines(
            ClaudeLine.human("2026-10-05T10:31:00Z"), ClaudeLine.assistant("2026-10-05T10:31:20Z", id: "m", out: 56)))
        try box.tracker().processFile(path, source: ClaudeSource())

        let built = try PayloadBuilder.build(store: box.store, device: device)
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(built.payload)) as? [String: Any])
        #expect(json["schema"] as? Int == 1)
        #expect(Set((json["device"] as? [String: Any])?.keys ?? [:].keys) == ["id", "name", "os", "agentVersion", "timezone"])
        let minute = try #require((json["minutes"] as? [[String: Any]])?.first)
        #expect(minute["t"] as? String == "2026-10-05T10:31:00Z")
        let apps = try #require(minute["apps"] as? [[String: Any]])
        #expect(apps.contains { $0["id"] as? String == "private" && $0["name"] is NSNull })
        #expect(apps.reduce(0) { $0 + ($1["sec"] as? Int ?? 0) } == 60)
        let meeting = try #require((minute["meetings"] as? [[String: Any]])?.first)
        #expect(meeting["id"] as? String == "us.zoom.xos" && meeting["name"] as? String == "Zoom" && meeting["sec"] as? Int == 20)
        #expect(json["deletedChats"] == nil)
        let agentRow = try #require((minute["agents"] as? [[String: Any]])?.first)
        #expect(Set(agentRow.keys) == ["agent", "sec", "sessions", "peak", "tokensIn", "tokensCached", "tokensOut", "workSec", "threads"])
        let chat = try #require((json["chats"] as? [[String: Any]])?.first)
        #expect(Set(chat.keys) == ["agent", "chatId", "firstAt", "lastAt", "agentSec", "turns", "tokensIn", "tokensCached", "tokensOut"])
        #expect(chat["chatId"] as? String == chatId(agent: "claude", sessionId: "s1"))
        #expect((chat["chatId"] as? String)?.count == 16)
    }

    @Test func emptyDirtyMinutesAreStillSent() throws {
        let box = try Sandbox()
        try box.store.markMinuteDirty(600)
        let built = try PayloadBuilder.build(store: box.store, device: device)
        #expect(built.payload.minutes == [MinutePayload(t: "1970-01-01T00:10:00Z", apps: [], agents: [])])
    }

    @Test func humanSecondsAreCappedAtSixty() {
        let capped = PayloadBuilder.capped([AppEntry(id: "a", name: "A", sec: 50), AppEntry(id: "b", name: "B", sec: 20)])
        #expect(capped.reduce(0) { $0 + $1.sec } == 60)
    }

    @Test func processSessionsAreNotChats() throws {
        let box = try Sandbox()
        try box.tracker().recordBusyProcesses(["amp"], minute: 600)
        try box.store.markChatDirty(agent: "amp", session: "process")
        #expect(try PayloadBuilder.build(store: box.store, device: device).payload.chats == nil)
    }

    @Test func decodesStatusLeniently() throws {
        let json = #"{"user":{"name":"G","handle":"g","level":21,"xp":480,"xpForNext":2100,"league":"silver","weeklyRank":9,"weeklyOf":34,"extra":true},"today":{"humanSec":15120,"agentSec":34800,"xp":420},"quests":[{"id":"q1","kind":"live","title":"Stay 15 minutes longer","xp":200,"progress":0,"target":900,"unit":"sec","state":"offered","expiresAt":null}],"dashboardUrl":"https://arena.test/u/g"}"#
        let status = try JSONDecoder().decode(StatusPayload.self, from: Data(json.utf8))
        #expect(status.user?.level == 21)
        #expect(status.quests?.first?.state == "offered")
        let sparse = try JSONDecoder().decode(StatusPayload.self, from: Data(#"{"user":{"name":"G","weeklyRank":null}}"#.utf8))
        #expect(sparse.user?.weeklyRank == nil)
    }
}

struct HumanRecorderTests {
    let safari = FrontApp(bundleId: "com.apple.Safari", name: "Safari")
    let zoom = MicApp(bundleId: "us.zoom.xos", name: "Zoom", use: .call)

    @discardableResult
    func tick(_ recorder: HumanRecorder, _ iso: String, idle: Double = 1, app: FrontApp?, suspended: Bool = false,
              title: String? = nil, privateApps: Set<String> = [], mic: MicApps.Reading = .none,
              calendar: String? = nil) throws -> HumanRecorder.Result {
        try recorder.record(HumanRecorder.Tick(now: at(iso), idleSeconds: idle, app: app, windowTitle: title,
                                               suspended: suspended, mic: mic, calendarMeeting: calendar),
                            privateApps: privateApps)
    }

    func minute(_ iso: String) -> MinuteT { minuteOf(at(iso)) }

    @Test func inputInsideAMinuteMakesItActive() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        #expect(try tick(recorder, "2026-10-05T10:00:02Z", idle: 1, app: safari).activated == minute("2026-10-05T10:00:00Z"))
        // Same input seen again: no new activation, nothing re-dirtied.
        #expect(try tick(recorder, "2026-10-05T10:00:07Z", idle: 6, app: safari).activated == nil)
        // No input for the rest of the minute and the next: 10:01 stays inactive.
        for s in stride(from: 12, through: 57, by: 5) { try tick(recorder, "2026-10-05T10:00:\(s)Z", idle: Double(s - 1), app: safari) }
        for s in stride(from: 2, through: 57, by: 5) {
            try tick(recorder, String(format: "2026-10-05T10:01:%02dZ", s), idle: Double(60 + s - 1), app: safari)
        }
        #expect(try box.store.isActive(minute("2026-10-05T10:00:00Z")))
        #expect(try !box.store.isActive(minute("2026-10-05T10:01:00Z")))
        #expect(try box.store.humanSeconds(from: 0, to: minute("2026-10-05T11:00:00Z")) == 60)
    }

    @Test func inputJustBeforeTheBoundaryCountsForItsOwnMinute() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        try tick(recorder, "2026-10-05T10:00:55Z", idle: 30, app: safari)  // old input, before this run
        // Input at 10:00:58 is first seen by the tick at 10:01:00.
        #expect(try tick(recorder, "2026-10-05T10:01:00Z", idle: 2, app: safari).activated == minute("2026-10-05T10:00:00Z"))
        #expect(try !box.store.isActive(minute("2026-10-05T10:01:00Z")))
    }

    @Test func suspendedTicksRecordNothing() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        try tick(recorder, "2026-10-05T10:00:00Z", idle: 20, app: safari)
        let result = try tick(recorder, "2026-10-05T10:00:05Z", idle: 0, app: safari, suspended: true)
        #expect(result == HumanRecorder.Result(activated: nil, appSeconds: 0, meetingSeconds: 0))
        #expect(try !box.store.isActive(minute("2026-10-05T10:00:00Z")))
        // Input that happened while paused isn't picked up afterwards either.
        #expect(try tick(recorder, "2026-10-05T10:00:10Z", idle: 7, app: safari).activated == nil)
    }

    @Test func dictationCountsAsInput() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        let dictating = MicApps.Reading(dictating: true, meeting: nil)
        try tick(recorder, "2026-10-05T10:00:00Z", idle: 300, app: safari)
        #expect(try tick(recorder, "2026-10-05T10:00:05Z", idle: 305, app: safari, mic: dictating).activated == minute("2026-10-05T10:00:00Z"))
        // After a gap the minute still activates, but the gap itself earns no app share.
        let afterGap = try tick(recorder, "2026-10-05T10:01:01Z", idle: 361, app: safari, mic: dictating)
        #expect(afterGap.activated == minute("2026-10-05T10:01:00Z") && afterGap.appSeconds == 0)
        #expect(try tick(recorder, "2026-10-05T10:01:06Z", idle: 366, app: safari, mic: dictating).appSeconds == 5)
    }

    @Test func appSharesNeedRecentPresence() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        #expect(try tick(recorder, "2026-10-05T10:00:00Z", app: safari).appSeconds == 0)  // first tick only sets the clock
        #expect(try tick(recorder, "2026-10-05T10:00:05Z", idle: 119, app: safari).appSeconds == 5)
        #expect(try tick(recorder, "2026-10-05T10:00:10Z", idle: 120, app: safari).appSeconds == 0)
        #expect(try tick(recorder, "2026-10-05T10:05:00Z", app: safari).appSeconds == 0)  // slept
        #expect(try box.store.appSeconds(t: minute("2026-10-05T10:00:00Z")).first?.sec == 5)
    }

    @Test func privateAppsAreAnonymous() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        try tick(recorder, "2026-10-05T10:00:00Z", app: safari)
        try tick(recorder, "2026-10-05T10:00:05Z", app: safari, title: "Bank", privateApps: [safari.bundleId])
        let rows = try box.store.appSeconds(t: minute("2026-10-05T10:00:00Z"))
        #expect(rows == [Store.AppSeconds(bundleId: "private", appName: "", sec: 5)])
        #expect(try box.store.titleTotals(from: 0, to: minuteOf(testNow), limit: 5).isEmpty)
    }

    @Test func meetingsAreCappedAndDontMakeMinutesActive() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        let call = MicApps.Reading(dictating: false, meeting: zoom)
        try tick(recorder, "2026-10-05T10:00:00Z", idle: 600, app: safari, mic: call)
        var credited = 0
        for s in stride(from: 5, through: 55, by: 5) {
            credited += try tick(recorder, String(format: "2026-10-05T10:00:%02dZ", s), idle: Double(600 + s), app: safari, mic: call).meetingSeconds
        }
        try box.store.addMeetingSeconds(t: minute("2026-10-05T10:01:00Z"), bundleId: "us.zoom.xos", appName: "Zoom", sec: 58)
        credited += try tick(recorder, "2026-10-05T10:01:00Z", idle: 660, app: safari, mic: call).meetingSeconds
        #expect(credited == 57)  // 55 s in 10:00, then only 2 s left in 10:01
        #expect(try box.store.meetingTotal(from: 0, to: minute("2026-10-05T11:00:00Z")) == 115)
        #expect(try !box.store.isActive(minute("2026-10-05T10:00:00Z")))
        #expect(try box.store.appSeconds(t: minute("2026-10-05T10:00:00Z")).isEmpty)  // idle, so no app share
    }

    @Test func calendarMeetingsCountUnlessACallAppHasTheMic() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        try tick(recorder, "2026-10-05T10:00:00Z", app: safari, calendar: "Design review")
        #expect(try tick(recorder, "2026-10-05T10:00:05Z", app: safari, calendar: "Design review").meetingSeconds == 5)
        // A call app takes the minute's credit instead.
        _ = try tick(recorder, "2026-10-05T10:00:10Z", app: safari, mic: MicApps.Reading(dictating: false, meeting: zoom), calendar: "Design review")
        let rows = try box.store.meetingSeconds(t: minute("2026-10-05T10:00:00Z"))
        #expect(Set(rows.map(\.bundleId)) == ["calendar", "us.zoom.xos"])
        // Locked or asleep: nothing.
        #expect(try tick(recorder, "2026-10-05T10:00:15Z", app: safari, suspended: true, calendar: "Design review").meetingSeconds == 0)
    }

    @Test func calendarTitlesStayOnThisMac() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        try tick(recorder, "2026-10-05T10:00:00Z", app: safari, calendar: "Secret acquisition talks")
        try tick(recorder, "2026-10-05T10:00:05Z", app: safari, calendar: "Secret acquisition talks")
        let built = try PayloadBuilder.build(store: box.store, device: DeviceInfo(id: "d", name: "Mac", os: "macOS", agentVersion: "0"))
        let json = String(decoding: try JSONEncoder().encode(built.payload), as: UTF8.self)
        #expect(json.contains("Calendar meeting"))
        #expect(!json.contains("Secret acquisition"))
    }

    @Test func calendarRulesSkipWhatIsntAMeeting() {
        let now = at("2026-10-05T10:30:00Z")
        func event(_ title: String, allDay: Bool = false, free: Bool = false, others: Int = 2, declined: Bool = false) -> CalendarRules.Event {
            CalendarRules.Event(title: title, start: at("2026-10-05T10:00:00Z"), end: at("2026-10-05T11:00:00Z"), isAllDay: allDay,
                                isFree: free, isCancelled: false, otherAttendees: others, youDeclined: declined)
        }
        #expect(CalendarRules.current([event("Standup")], at: now)?.title == "Standup")
        for skipped in [event("Holiday", allDay: true), event("Focus", free: true), event("Solo", others: 0), event("Nope", declined: true)] {
            #expect(CalendarRules.current([skipped], at: now) == nil)
        }
    }

    @Test func privateMeetingAppsAreAnonymous() throws {
        let box = try Sandbox()
        let recorder = HumanRecorder(store: box.store)
        let call = MicApps.Reading(dictating: false, meeting: zoom)
        try tick(recorder, "2026-10-05T10:00:00Z", app: safari, mic: call)
        try tick(recorder, "2026-10-05T10:00:05Z", app: safari, privateApps: [zoom.bundleId], mic: call)
        #expect(try box.store.meetingSeconds(t: minute("2026-10-05T10:00:00Z")) == [Store.AppSeconds(bundleId: "private", appName: "", sec: 5)])
    }
}

struct ActiveMinutePayloadTests {
    let device = DeviceInfo(id: "dev-1", name: "Test Mac", os: "macOS 26.0", agentVersion: "0.1.0")

    @Test func activeMinutesAreScaledToSixty() {
        let apps = PayloadBuilder.normalized([AppEntry(id: "a", name: "A", sec: 10), AppEntry(id: "b", name: "B", sec: 10),
                                              AppEntry(id: "c", name: "C", sec: 10)])
        #expect(apps.map(\.sec) == [20, 20, 20])
        let uneven = PayloadBuilder.normalized([AppEntry(id: "a", name: "A", sec: 2), AppEntry(id: "b", name: "B", sec: 1)])
        #expect(uneven.map(\.sec) == [40, 20])
        let thirds = PayloadBuilder.normalized([AppEntry(id: "a", name: "A", sec: 1), AppEntry(id: "b", name: "B", sec: 1),
                                                AppEntry(id: "c", name: "C", sec: 1), AppEntry(id: "d", name: "D", sec: 4)])
        #expect(thirds.reduce(0) { $0 + $1.sec } == 60)
        #expect(PayloadBuilder.normalized([]) == [AppEntry(id: "unknown", name: "Other", sec: 60)])
    }

    @Test func inactiveMinutesSendNoApps() throws {
        let box = try Sandbox()
        try box.store.addAppSeconds(t: 600, bundleId: "a", appName: "A", sec: 25)
        try box.store.addAppSeconds(t: 660, bundleId: "a", appName: "A", sec: 25)
        try box.store.markActive(660)
        let minutes = try PayloadBuilder.build(store: box.store, device: device).payload.minutes
        #expect(minutes.first { $0.t == "1970-01-01T00:10:00Z" }?.apps == [])
        #expect(minutes.first { $0.t == "1970-01-01T00:11:00Z" }?.apps == [AppEntry(id: "a", name: "A", sec: 60)])
        #expect(try box.store.humanSeconds(from: 0, to: 6000) == 60)
    }

    @Test func activeMinuteWithoutAppsGoesToOther() throws {
        let box = try Sandbox()
        try box.store.markActive(600)
        let minute = try #require(try PayloadBuilder.build(store: box.store, device: device).payload.minutes.first)
        #expect(minute.apps == [AppEntry(id: "unknown", name: "Other", sec: 60)])
    }

    @Test func markingAgainDoesntRedirty() throws {
        let box = try Sandbox()
        #expect(try box.store.markActive(600))
        try box.store.clearDirtyMinutes([600])
        #expect(try !box.store.markActive(600))
        #expect(try box.store.dirtyMinutes(limit: 10).isEmpty)
    }

    @Test func existingAppMinutesBecomeActiveOnUpgrade() throws {
        let box = try Sandbox()
        try box.store.addAppSeconds(t: 600, bundleId: "a", appName: "A", sec: 25)
        try box.store.setValue(nil, for: Store.humanSchemaKey)  // pretend this store came from version 1
        let reopened = try Store(path: box.store.path)
        #expect(try reopened.isActive(600))
        try reopened.addAppSeconds(t: 660, bundleId: "a", appName: "A", sec: 25)
        #expect(try !Store(path: box.store.path).isActive(660))  // runs once
    }
}

struct MicAppsTests {
    @Test func matchesHelpersByPrefix() {
        #expect(MicApps.app(forBundleId: "com.google.Chrome.helper")?.name == "Google Chrome")
        #expect(MicApps.app(forBundleId: "com.electron.wispr-flow.helper")?.use == .dictation)
        #expect(MicApps.app(forBundleId: "com.electron.wispr-flow.accessibility-mac-app")?.use == .dictation)
        #expect(MicApps.app(forBundleId: "com.microsoft.teams2")?.bundleId == "com.microsoft.teams2")
        #expect(MicApps.app(forBundleId: "com.google.Chromebook") == nil)  // prefix must end on a dot
        #expect(MicApps.app(forBundleId: "com.apple.VoiceMemos") == nil)
    }

    @Test func callAppsWinOverNotesAndBrowsers() {
        let reading = MicApps.classify(["com.google.Chrome.helper", "com.granola.app", "us.zoom.xos", "com.apple.VoiceMemos"],
                                       outputtingBundleIds: ["com.google.Chrome.helper"])
        #expect(reading.meeting?.name == "Zoom")
        #expect(!reading.dictating)
        #expect(MicApps.classify(["com.google.Chrome.helper", "com.granola.app"]).meeting?.name == "Granola")
        #expect(MicApps.classify(["com.google.Chrome.helper"], outputtingBundleIds: ["com.google.Chrome.helper.Renderer"]).meeting?.use == .browserCall)
    }

    @Test func aBrowserThatOnlyListensIsRecordingNotACall() {
        // Recording in a browser (mic, no playback) isn't a meeting; Zoom doesn't need playback.
        #expect(MicApps.classify(["com.google.Chrome.helper"]).meeting == nil)
        #expect(MicApps.classify(["com.google.Chrome.helper"], outputtingBundleIds: ["us.zoom.xos"]).meeting == nil)
        #expect(MicApps.classify(["us.zoom.xos"]).meeting?.name == "Zoom")
    }

    @Test func dictationIsNotAMeeting() {
        let reading = MicApps.classify(["com.electron.wispr-flow.helper"])
        #expect(reading.dictating)
        #expect(reading.meeting == nil)
        #expect(MicApps.classify([]) == .none)
    }
}

struct SettingsTests {
    @Test func roundTripsThroughTheStore() throws {
        let box = try Sandbox()
        var settings = try ArenaSettings.load(from: box.store)
        settings.serverURL = URL(string: "https://arena.test")
        settings.privateApps = ["com.a", "com.b"]
        settings.windowTitlesEnabled = true
        settings.pausedUntil = .distantFuture
        try settings.save(to: box.store)
        let loaded = try ArenaSettings.load(from: box.store)
        #expect(loaded.serverURL == settings.serverURL)
        #expect(loaded.privateApps == settings.privateApps)
        #expect(loaded.windowTitlesEnabled)
        #expect(loaded.isPaused(at: testNow))
        #expect(loaded.deviceId == settings.deviceId)
    }

    @Test func parsesPairingLinks() {
        let link = PairingLink("arena://pair?server=https%3A%2F%2Farena.clueso.io&token=abc123")
        #expect(link?.server.absoluteString == "https://arena.clueso.io")
        #expect(link?.token == "abc123")
        #expect(PairingLink("arena://pair?token=abc") == nil)
        #expect(PairingLink("https://evil.test/pair?server=https://x&token=a") == nil)
        #expect(PairingLink("arena://pair?server=file:///etc&token=a") == nil)
    }

    @Test func backoffDoublesAndResets() {
        var backoff = Backoff()
        #expect(backoff.allows(testNow))
        backoff.failed(at: testNow)
        #expect(!backoff.allows(testNow.addingTimeInterval(29)))
        #expect(backoff.allows(testNow.addingTimeInterval(30)))
        backoff.failed(at: testNow)
        #expect(!backoff.allows(testNow.addingTimeInterval(59)))
        backoff.succeeded()
        #expect(backoff.allows(testNow))
    }
}

struct LineReaderTests {
    @Test func leavesPartialLinesAndSkipsOversizedOnes() throws {
        let box = try Sandbox()
        let big = String(repeating: "x", count: 300)
        let path = try box.write("f.jsonl", "a\n\(big)\nb\npartial")
        let first = try LineReader.read(path: path, from: 0, maxBytes: 100)
        #expect(first.lines.map { String(decoding: $0, as: UTF8.self) } == ["a"])
        let second = try LineReader.read(path: path, from: first.newOffset, maxBytes: 100)
        #expect(second.lines.isEmpty)
        let third = try LineReader.read(path: path, from: second.newOffset, maxBytes: 100)
        #expect(third.lines.map { String(decoding: $0, as: UTF8.self) } == ["b"])
        #expect(third.newOffset == Int64("a\n\(big)\nb\n".utf8.count))
        #expect(!third.reachedEnd)
        let fourth = try LineReader.read(path: path, from: third.newOffset, maxBytes: 100)
        #expect(fourth.lines.isEmpty && fourth.reachedEnd)
    }

    @Test func aCallWinsTheMinuteForHumanTime() throws {
        let box = try Sandbox()
        _ = try box.store.markActive(600)
        _ = try box.store.markActive(660)
        try box.store.addMeetingSeconds(t: 660, bundleId: "us.zoom.xos", appName: "zoom.us", sec: 45)
        // Minute 600: typing only. Minute 660: typing and 45 s of call.
        #expect(try box.store.humanSeconds(from: 0, to: 6000) == 60 + 15)
        #expect(try box.store.meetingTotal(from: 0, to: 6000) == 45)
    }
}

struct ResendTests {
    @Test func pairingQueuesTheLast24HoursAgain() throws {
        let box = try Sandbox()
        let old = minuteOf(at("2026-10-04T08:00:00Z"))
        let recent = minuteOf(at("2026-10-05T09:00:00Z"))
        let call = minuteOf(at("2026-10-05T09:05:00Z"))
        try box.store.addAppSeconds(t: old, bundleId: "com.apple.Safari", appName: "Safari", sec: 30)
        try box.store.addAppSeconds(t: recent, bundleId: "com.apple.Safari", appName: "Safari", sec: 30)
        try box.store.addMeetingSeconds(t: call, bundleId: "us.zoom.xos", appName: "Zoom", sec: 40)
        try box.store.setSessionMinute(agent: "claude", session: "s1", t: recent, sec: 60)
        try box.store.clearDirtyMinutes(try box.store.dirtyMinutes(limit: 100))
        try box.store.clearDirtyChats(try box.store.dirtyChats(limit: 100))

        try box.store.markForResend(since: minuteOf(at("2026-10-04T10:00:00Z")))

        #expect(try box.store.dirtyMinutes(limit: 100) == [recent, call])
        #expect(try box.store.dirtyChats(limit: 100).map { "\($0.agent)/\($0.session)" } == ["claude/s1"])
    }
}

struct MenuQuestTests {
    func quest(_ id: String, _ state: String, _ progress: Double, _ target: Double) -> QuestStatus {
        QuestStatus(id: id, kind: "daily", title: id, xp: 100, progress: progress, target: target, unit: "sec", state: state, expiresAt: nil)
    }

    @Test func showsTheThreeClosestToDoneAfterOffers() {
        let quests = [quest("a", "active", 1, 10), quest("b", "active", 9, 10), quest("c", "active", 5, 10),
                      quest("d", "active", 0, 10), quest("live", "offered", 0, 10)]
        let shown = QuestStatus.forMenu(quests)
        #expect(shown.offered.map(\.id) == ["live"])
        #expect(shown.active.map(\.id) == ["b", "c"])
        #expect(QuestStatus.forMenu(quests.filter { $0.state == "active" }).active.map(\.id) == ["b", "c", "a"])
    }
}

struct PairingRequestTests {
    @Test func connectURLCarriesStateAndName() throws {
        let url = try #require(PairingRequest.connectURL(server: URL(string: "https://arena.example.com")!, state: "ab12", deviceName: "Ana’s Mac"))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(url.path == "/connect/mac")
        #expect(items.first { $0.name == "state" }?.value == "ab12")
        #expect(items.first { $0.name == "name" }?.value == "Ana’s Mac")
    }

    @Test func pairingLinkReadsState() {
        #expect(PairingLink("arena://pair?server=https%3A%2F%2Fa.example.com&token=t&state=ab12")?.state == "ab12")
        #expect(PairingLink("arena://pair?server=https%3A%2F%2Fa.example.com&token=t")?.state == nil)
        #expect(PairingRequest.newState().count == 32)
    }
}

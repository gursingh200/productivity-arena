import Foundation

/// The app in front, as reported by the platform sensor.
public struct FrontApp: Equatable, Sendable {
    public var bundleId: String
    public var name: String

    public init(bundleId: String, name: String) {
        self.bundleId = bundleId
        self.name = name
    }
}

/// Records human activity from the ~5 s tick.
///
/// - Active minutes: a wall-clock minute is active when any keyboard, mouse,
///   trackpad or scroll input happened inside it, or a dictation app was
///   capturing the microphone during it. Human time is 60 s per active minute.
///   The idle sensor reports the time since the latest input, so each tick
///   marks the minute of that input when it is newer than the previous tick.
/// - App shares: each tick's elapsed time goes to the frontmost app while the
///   person was recently present (input or dictation within `presenceWindow`).
///   Uploads scale an active minute's shares to 60 s; inactive minutes send none.
/// - Meetings: each tick's elapsed time goes to one meeting app capturing the
///   microphone (call apps over notes apps over browsers), capped at 60 s per
///   minute. Meetings never make a minute active on their own.
/// - Nothing is recorded while paused, locked or asleep, and gaps longer than
///   `maxTickGap` (e.g. sleep) are never credited.
public final class HumanRecorder {

    /// How recently the person must have been present for a tick's time to count as app share.
    public static let presenceWindow: TimeInterval = 120
    /// Longest gap between ticks still credited (covers timer coalescing, not sleep).
    static let maxTickGap: TimeInterval = 10

    private let store: Store
    private var lastTick: Date?
    private var meetingThisMinute: (t: MinuteT, sec: Int) = (-1, 0)

    public init(store: Store) {
        self.store = store
    }

    public struct Tick {
        public var now: Date
        public var idleSeconds: TimeInterval
        public var app: FrontApp?
        public var windowTitle: String?
        public var suspended: Bool  // paused, locked, asleep
        public var mic: MicApps.Reading

        public init(now: Date, idleSeconds: TimeInterval, app: FrontApp?, windowTitle: String?, suspended: Bool,
                    mic: MicApps.Reading = .none) {
            self.now = now
            self.idleSeconds = idleSeconds
            self.app = app
            self.windowTitle = windowTitle
            self.suspended = suspended
            self.mic = mic
        }
    }

    public struct Result: Equatable {
        /// The minute newly marked active by this tick, if any.
        public var activated: MinuteT?
        public var appSeconds: Int
        public var meetingSeconds: Int
    }

    /// Records one tick.
    @discardableResult
    public func record(_ tick: Tick, privateApps: Set<String>) throws -> Result {
        var result = Result(activated: nil, appSeconds: 0, meetingSeconds: 0)
        let previous = lastTick
        lastTick = tick.now
        guard !tick.suspended else { return result }

        // Active minute. The first tick after launch or wake only trusts very recent input.
        let dictating = tick.mic.dictating
        let lastInput = dictating ? tick.now : tick.now.addingTimeInterval(-tick.idleSeconds)
        let inputIsNew = previous.map { lastInput > $0 } ?? (tick.idleSeconds <= Self.maxTickGap)
        if dictating || inputIsNew {
            let t = minuteOf(lastInput)
            if try store.markActive(t) { result.activated = t }
        }

        guard let previous else { return result }
        let elapsed = tick.now.timeIntervalSince(previous)
        guard elapsed > 0, elapsed <= Self.maxTickGap else { return result }
        let seconds = Int(elapsed.rounded())
        guard seconds > 0 else { return result }
        let t = minuteOf(tick.now)

        // App share.
        if let app = tick.app, dictating || tick.idleSeconds < Self.presenceWindow {
            let isPrivate = privateApps.contains(app.bundleId)
            try store.addAppSeconds(t: t, bundleId: isPrivate ? "private" : app.bundleId,
                                    appName: isPrivate ? "" : app.name, sec: seconds)
            if !isPrivate, let title = tick.windowTitle, !title.isEmpty {
                try store.addTitleSeconds(t: t, bundleId: app.bundleId, title: title, sec: seconds)
            }
            result.appSeconds = seconds
        }

        // Meeting time.
        if let meeting = tick.mic.meeting {
            if meetingThisMinute.t != t {
                meetingThisMinute = (t, try store.meetingSeconds(t: t).reduce(0) { $0 + $1.sec })
            }
            let credit = min(seconds, 60 - meetingThisMinute.sec)
            if credit > 0 {
                let isPrivate = privateApps.contains(meeting.bundleId)
                try store.addMeetingSeconds(t: t, bundleId: isPrivate ? "private" : meeting.bundleId,
                                            appName: isPrivate ? "" : meeting.name, sec: credit)
                meetingThisMinute.sec += credit
                result.meetingSeconds = credit
            }
        }
        return result
    }

    /// Forget the previous tick, e.g. after wake, so the gap isn't credited.
    public func reset() {
        lastTick = nil
    }
}

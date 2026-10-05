import Foundation

/// What an app capturing the microphone is doing.
public enum MicUse: Int, Sendable, Comparable {
    /// Dictation counts as human input (the person is "typing" by voice).
    case dictation
    /// A browser using the mic is treated as a call (Meet and friends).
    case browserCall
    /// A notes app that listens along to a meeting.
    case meetingNotes
    /// A dedicated call app.
    case call

    public static func < (a: MicUse, b: MicUse) -> Bool { a.rawValue < b.rawValue }
}

/// A recognized app that is capturing the microphone.
public struct MicApp: Equatable, Sendable {
    /// The app's main bundle id (helpers are mapped back to it).
    public var bundleId: String
    public var name: String
    public var use: MicUse

    public init(bundleId: String, name: String, use: MicUse) {
        self.bundleId = bundleId
        self.name = name
        self.use = use
    }
}

/// Classifies processes capturing audio input by bundle id. Pure, so the
/// platform sensor only has to report bundle ids.
///
/// Matching is by prefix on a dot boundary, so helper processes such as
/// `com.google.Chrome.helper` or `com.electron.wispr-flow.helper` match their app.
public enum MicApps {

    public static let known: [MicApp] = [
        // Dictation. Wispr Flow verified on a real machine; the other two from
        // their published bundle ids.
        MicApp(bundleId: "com.electron.wispr-flow", name: "Wispr Flow", use: .dictation),
        MicApp(bundleId: "com.superduper.superwhisper", name: "Superwhisper", use: .dictation),
        MicApp(bundleId: "com.goodsnooze.MacWhisper", name: "MacWhisper", use: .dictation),

        // Call apps. Zoom, Slack, Discord verified installed; the rest not verified on a machine.
        MicApp(bundleId: "us.zoom.xos", name: "Zoom", use: .call),
        MicApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", use: .call),
        MicApp(bundleId: "com.hnc.Discord", name: "Discord", use: .call),
        MicApp(bundleId: "com.microsoft.teams2", name: "Microsoft Teams", use: .call),
        MicApp(bundleId: "com.microsoft.teams", name: "Microsoft Teams", use: .call),
        MicApp(bundleId: "com.apple.FaceTime", name: "FaceTime", use: .call),
        MicApp(bundleId: "Cisco-Systems.Spark", name: "Webex", use: .call),
        MicApp(bundleId: "com.webex.meetingmanager", name: "Webex", use: .call),
        MicApp(bundleId: "co.teamport.around", name: "Around", use: .call),
        MicApp(bundleId: "app.tuple.app", name: "Tuple", use: .call),

        // Meeting notes (verified installed).
        MicApp(bundleId: "com.granola.app", name: "Granola", use: .meetingNotes),

        // Browsers: mic use is almost always a call (Google Meet, Zoom web, huddles).
        MicApp(bundleId: "com.google.Chrome", name: "Google Chrome", use: .browserCall),
        MicApp(bundleId: "company.thebrowser.Browser", name: "Arc", use: .browserCall),
        MicApp(bundleId: "com.apple.Safari", name: "Safari", use: .browserCall),
        // Safari captures audio in the shared WebKit GPU process.
        MicApp(bundleId: "com.apple.WebKit.GPU", name: "Safari", use: .browserCall),
        MicApp(bundleId: "org.mozilla.firefox", name: "Firefox", use: .browserCall),
        MicApp(bundleId: "com.microsoft.edgemac", name: "Microsoft Edge", use: .browserCall),
        MicApp(bundleId: "com.brave.Browser", name: "Brave", use: .browserCall),
    ]

    /// The known app a capturing process belongs to, if any.
    public static func app(forBundleId id: String) -> MicApp? {
        // Longest prefix wins, so com.microsoft.teams2 isn't read as com.microsoft.teams.
        known.filter { id == $0.bundleId || id.hasPrefix($0.bundleId + ".") }
            .max { $0.bundleId.count < $1.bundleId.count }
    }

    public struct Reading: Equatable, Sendable {
        /// A dictation app is capturing right now.
        public var dictating: Bool
        /// The meeting app to credit, preferring call apps over notes apps over browsers.
        public var meeting: MicApp?

        public init(dictating: Bool, meeting: MicApp?) {
            self.dictating = dictating
            self.meeting = meeting
        }

        public static let none = Reading(dictating: false, meeting: nil)
    }

    /// Classifies the bundle ids of every process currently capturing input.
    /// Unknown apps (voice memos, audio tools…) are ignored.
    public static func classify(_ capturingBundleIds: [String]) -> Reading {
        let apps = capturingBundleIds.compactMap(app(forBundleId:))
        let meeting = apps.filter { $0.use != .dictation }
            .max { $0.use != $1.use ? $0.use < $1.use : $0.bundleId > $1.bundleId }
        return Reading(dictating: apps.contains { $0.use == .dictation }, meeting: meeting)
    }
}

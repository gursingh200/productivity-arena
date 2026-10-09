import Foundation

/// Which calendar events count as meetings: real meetings with other people
/// that you haven't declined. Pure, so the EventKit sensor only reports facts.
public enum CalendarRules {
    public struct Event: Equatable, Sendable {
        public var title: String
        public var start: Date
        public var end: Date
        public var isAllDay: Bool
        /// Marked "free" rather than "busy".
        public var isFree: Bool
        public var isCancelled: Bool
        /// People invited other than you.
        public var otherAttendees: Int
        public var youDeclined: Bool

        public init(title: String, start: Date, end: Date, isAllDay: Bool, isFree: Bool, isCancelled: Bool,
                    otherAttendees: Int, youDeclined: Bool) {
            self.title = title
            self.start = start
            self.end = end
            self.isAllDay = isAllDay
            self.isFree = isFree
            self.isCancelled = isCancelled
            self.otherAttendees = otherAttendees
            self.youDeclined = youDeclined
        }
    }

    public static func counts(_ e: Event) -> Bool {
        !e.isAllDay && !e.isFree && !e.isCancelled && e.otherAttendees > 0 && !e.youDeclined
    }

    /// The meeting happening at `now`, if any (the earliest-started one when they overlap).
    public static func current(_ events: [Event], at now: Date) -> Event? {
        events.filter { counts($0) && $0.start <= now && now < $0.end }.min { $0.start < $1.start }
    }
}

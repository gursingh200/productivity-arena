import EventKit
import Foundation
import ArenaCore

/// Reads the macOS Calendar (which includes Google calendars added in System
/// Settings → Internet Accounts) for the meeting happening now. Events are
/// fetched every few minutes, not on every tick. Nothing is sent anywhere.
public final class CalendarSensor: @unchecked Sendable {
    private let store = EKEventStore()
    private let lock = NSLock()
    private var events: [CalendarRules.Event] = []
    private var fetchedAt = Date.distantPast
    static let refreshInterval: TimeInterval = 5 * 60

    public init() {
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { [weak self] _ in
            self?.lock.withLock { self?.fetchedAt = .distantPast }
        }
    }

    public static var hasAccess: Bool {
        EKEventStore.authorizationStatus(for: .event) == .fullAccess
    }

    /// Asks for calendar access (macOS shows its prompt once). Calls back on the main queue.
    public func requestAccess(_ done: @escaping @Sendable (Bool) -> Void) {
        store.requestFullAccessToEvents { granted, _ in DispatchQueue.main.async { done(granted) } }
    }

    /// The title of the qualifying meeting happening now, if any.
    public func currentMeeting(at now: Date = Date()) -> String? {
        guard Self.hasAccess else { return nil }
        let stale = lock.withLock { now.timeIntervalSince(fetchedAt) > Self.refreshInterval }
        if stale { refresh(around: now) }
        return lock.withLock { CalendarRules.current(events, at: now)?.title }
    }

    private func refresh(around now: Date) {
        let predicate = store.predicateForEvents(withStart: now.addingTimeInterval(-12 * 3600),
                                                 end: now.addingTimeInterval(12 * 3600), calendars: nil)
        let fetched = store.events(matching: predicate).map { e -> CalendarRules.Event in
            let attendees = e.attendees ?? []
            return CalendarRules.Event(
                title: e.title ?? "Meeting", start: e.startDate, end: e.endDate, isAllDay: e.isAllDay,
                isFree: e.availability == .free, isCancelled: e.status == .canceled,
                otherAttendees: attendees.filter { !$0.isCurrentUser }.count,
                youDeclined: attendees.contains { $0.isCurrentUser && $0.participantStatus == .declined })
        }
        lock.withLock {
            events = fetched
            fetchedAt = now
        }
    }
}

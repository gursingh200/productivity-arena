import AppKit

/// Sleep/wake, display sleep, fast user switching and screen lock.
/// `isSuspended` is true while any of them means nobody is at the Mac.
public final class PowerEvents {

    public private(set) var isSuspended = false
    /// Called on the main queue when tracking should resume after a suspension.
    public var onResume: (() -> Void)?

    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    public init() {}

    public func start() {
        let workspace = NSWorkspace.shared.notificationCenter
        let distributed = DistributedNotificationCenter.default()
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification,
                     NSWorkspace.sessionDidResignActiveNotification] {
            observe(workspace, name, suspended: true)
        }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification,
                     NSWorkspace.sessionDidBecomeActiveNotification] {
            observe(workspace, name, suspended: false)
        }
        observe(distributed, Notification.Name("com.apple.screenIsLocked"), suspended: true)
        observe(distributed, Notification.Name("com.apple.screenIsUnlocked"), suspended: false)
    }

    public func stop() {
        for (center, observer) in observers { center.removeObserver(observer) }
        observers.removeAll()
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name, suspended: Bool) {
        let observer = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            let wasSuspended = self.isSuspended
            self.isSuspended = suspended
            if wasSuspended && !suspended { self.onResume?() }
        }
        observers.append((center, observer))
    }
}

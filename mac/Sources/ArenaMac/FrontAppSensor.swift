import AppKit
import ArenaCore

/// Tracks the frontmost app from NSWorkspace activation notifications (no polling).
public final class FrontAppSensor {

    public private(set) var current: FrontApp?
    private var observer: NSObjectProtocol?

    public init() {}

    public func start() {
        current = NSWorkspace.shared.frontmostApplication.map(Self.frontApp)
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.current = Self.frontApp(app)
        }
    }

    public func stop() {
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observer = nil
    }

    static func frontApp(_ app: NSRunningApplication) -> FrontApp {
        let bundleId = app.bundleIdentifier ?? app.executableURL?.lastPathComponent ?? "unknown"
        return FrontApp(bundleId: bundleId, name: app.localizedName ?? bundleId)
    }
}

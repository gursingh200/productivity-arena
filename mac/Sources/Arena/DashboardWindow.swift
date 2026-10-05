import AppKit
import ArenaCore
import SwiftUI

/// The "Your activity" window. Created on first open and released on close,
/// so it costs no memory while it isn't showing.
@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate {

    private let engine: ArenaEngine
    private var window: NSWindow?
    private var model: DashboardModel?

    init(engine: ArenaEngine) {
        self.engine = engine
    }

    func show(range: ActivityRange? = nil) {
        NSApp.activate(ignoringOtherApps: true)
        if let window {
            if let range { model?.range = range }
            window.makeKeyAndOrderFront(nil)
            return
        }
        let model = DashboardModel(engine: engine)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 780),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Your activity"
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(Palette.bg)
        window.minSize = NSSize(width: 780, height: 600)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: DashboardView(model: model))
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        self.model = model
        if let range { model.range = range } else { model.load() }
    }

    func windowWillClose(_ notification: Notification) {
        model?.stop()
        window?.contentViewController = nil
        window = nil
        model = nil
    }
}

/// State for the dashboard: which range is showing and its report.
@MainActor
final class DashboardModel: ObservableObject {

    @Published var range: ActivityRange = .day {
        didSet { interval = range.interval(containing: Date(), calendar: calendar); load() }
    }
    @Published private(set) var interval: DateInterval
    @Published private(set) var report: ActivityReport?
    @Published var heatSeries: ActivitySeries = .human
    @Published var selectedApp: String?

    let calendar = Calendar.current
    private let engine: ArenaEngine
    private var refresh: Timer?

    init(engine: ArenaEngine) {
        self.engine = engine
        self.interval = ActivityRange.day.interval(containing: Date(), calendar: Calendar.current)
        // While the window shows a range that includes now, keep it current.
        refresh = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.interval.contains(Date()) else { return }
                self.load()
            }
        }
    }

    var includesToday: Bool { interval.contains(Date()) }

    func step(_ steps: Int) {
        interval = range.shifted(interval, by: steps, calendar: calendar)
        selectedApp = nil
        load()
    }

    func goToToday() {
        interval = range.interval(containing: Date(), calendar: calendar)
        load()
    }

    func load() {
        let requested = interval
        engine.activityReport(for: requested, calendar: calendar) { [weak self] report in
            guard let self, self.interval == requested else { return }
            self.report = report
        }
    }

    func stop() {
        refresh?.invalidate()
        refresh = nil
    }
}

import AppKit
import ArenaCore
import ArenaMac

@main
final class AppDelegate: NSObject, NSApplicationDelegate {

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.mainMenu = editMenu()
        app.run()
    }

    /// Menu bar apps have no menu bar of their own, so ⌘V, ⌘C, ⌘X, ⌘A and ⌘Z
    /// do nothing in text fields (the pairing link box, the dashboard) unless
    /// these items exist. The menu is never shown; it only routes the shortcuts.
    private static func editMenu() -> NSMenu {
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editItem.submenu = edit
        let main = NSMenu()
        main.addItem(NSMenuItem(title: "Arena", action: nil, keyEquivalent: ""))
        main.addItem(editItem)
        return main
    }

    private var engine: ArenaEngine!
    private var menuBar: MenuBarController!
    private var notifications: QuestNotifications?
    private var dashboard: DashboardWindowController?
    private var updater: Updater?

    private let frontApp = FrontAppSensor()
    private let power = PowerEvents()
    private let processScanner = ProcessScanner()
    private var fileWatcher: FileWatcher?
    private var timers: [Timer] = []

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Handle arena://pair links, including the one that launched the app.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:reply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let store = try Store(path: Store.defaultPath())
            engine = try ArenaEngine(store: store, token: Keychain.loadToken(), device: Self.deviceInfo)
        } catch {
            NSLog("Arena: cannot open local store: %@", String(describing: error))
            NSApp.terminate(nil)
            return
        }

        menuBar = MenuBarController(engine: engine, frontApp: frontApp)
        menuBar.onPair = { [weak self] link in self?.pair(with: link) }
        menuBar.onOpenActivity = { [weak self] in self?.openActivity(range: nil) }
        menuBar.onQuestResponse = { [weak self] id, accept in
            guard let engine = self?.engine else { return }
            Task { await engine.respondToQuest(id: id, accept: accept) }
        }

        // Notifications need a real app bundle (not `swift run`).
        if Bundle.main.bundleIdentifier != nil {
            notifications = QuestNotifications()
            notifications?.onResponse = { [weak self] id, accept in
                guard let engine = self?.engine else { return }
                Task { await engine.respondToQuest(id: id, accept: accept) }
            }
        }

        engine.onStatus = { [weak self] status in
            self?.menuBar.update(status: status)
            self?.notifications?.offerLiveQuests(status.quests ?? [])
        }

        frontApp.start()
        power.onResume = { [weak self] in
            self?.engine.resetHumanClock()
            self?.uploadSoon()
        }
        power.start()

        let watcher = FileWatcher(paths: engine.watchedDirectories())
        watcher.onEvent = { [weak self] paths in self?.engine.filesChanged(paths) }
        watcher.start()
        fileWatcher = watcher

        engine.scanEverything()
        startTimers()
        uploadSoon()

        // Self-update from the releases repo (off in local builds without one).
        MainActor.assumeIsolated {
            updater = Updater()
            updater?.onChange = { [weak self] in self?.menuBar.updateStatus = self?.updater?.status }
            menuBar.updateStatus = updater?.status
            menuBar.onCheckForUpdates = updater.map { u in { MainActor.assumeIsolated { u.check() } } }
            updater?.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timers.forEach { $0.invalidate() }
        fileWatcher?.stop()
        frontApp.stop()
        power.stop()
    }

    // MARK: - Timers

    private func startTimers() {
        // Human activity tick. Tolerance lets macOS coalesce wakeups.
        schedule(every: 5, tolerance: 1) { [weak self] in self?.tick() }
        // Process-scan fallback for agents without readable logs.
        schedule(every: 60, tolerance: 10) { [weak self] in
            guard let self else { return }
            self.engine.busyProcesses(self.processScanner.busyAgents())
        }
        // Upload.
        schedule(every: 300, tolerance: 30) { [weak self] in self?.uploadSoon() }
        // Safety net for missed file events, and retention cleanup.
        schedule(every: 600, tolerance: 60) { [weak self] in self?.engine.scanEverything() }
        // Menu bar title.
        schedule(every: 60, tolerance: 10) { [weak self] in self?.menuBar.refreshTitle() }
    }

    private func schedule(every interval: TimeInterval, tolerance: TimeInterval, _ block: @escaping () -> Void) {
        let timer = Timer(timeInterval: interval, repeats: true) { _ in block() }
        timer.tolerance = tolerance
        RunLoop.main.add(timer, forMode: .common)
        timers.append(timer)
    }

    private func tick() {
        let titlesOn = engine.currentSettings().windowTitlesEnabled
        engine.tick(now: Date(), idleSeconds: IdleSensor.secondsSinceLastInput(), app: frontApp.current,
                    windowTitle: titlesOn ? WindowTitleSensor.focusedWindowTitle() : nil,
                    locked: power.isSuspended, micCapturing: MicSensor.capturingBundleIds())
    }

    private func uploadSoon() {
        Task { await engine.upload() }
    }

    // MARK: - Activity window

    /// Opens "Your activity", optionally on a range (arena://activity?range=week).
    /// Called on the main thread (menu actions, Apple events).
    private func openActivity(range: ActivityRange?) {
        guard engine != nil else { return }
        MainActor.assumeIsolated {
            if dashboard == nil { dashboard = DashboardWindowController(engine: engine) }
            dashboard?.show(range: range)
        }
    }

    // MARK: - Pairing

    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let string = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue else { return }
        // arena://activity opens the activity window; everything else is a pairing link.
        if let components = URLComponents(string: string), components.host == "activity" {
            openActivity(range: components.queryItems?.first { $0.name == "range" }?.value.flatMap(ActivityRange.init(rawValue:)))
            return
        }
        pair(with: string)
    }

    private func pair(with string: String) {
        guard let link = PairingLink(string) else {
            menuBar.showMessage("That isn't a valid Arena pairing link.")
            return
        }
        Keychain.saveToken(link.token)
        engine.setToken(link.token)
        engine.updateSettings { $0.serverURL = link.server }
        menuBar.showMessage("This Mac is now connected to \(link.server.host ?? "Arena").")
        uploadSoon()
    }

    private static func deviceInfo(id: String) -> DeviceInfo {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return DeviceInfo(id: id, name: Host.current().localizedName ?? "Mac",
                          os: "macOS \(os.majorVersion).\(os.minorVersion)", agentVersion: ArenaEngine.version)
    }
}

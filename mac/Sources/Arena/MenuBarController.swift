import AppKit
import ArenaCore
import ArenaMac

/// The status-bar item and its menu (spec §1.6). The menu is rebuilt each time
/// it opens, so nothing refreshes in the background except the title.
final class MenuBarController: NSObject, NSMenuDelegate {

    var onPair: ((String) -> Void)?
    var onConnectInBrowser: (() -> Void)?
    var onToggleCalendar: (() -> Void)?
    var onConnectLinear: ((String) -> Void)?
    var onDisconnectLinear: (() -> Void)?
    var onQuestResponse: ((String, Bool) -> Void)?
    var onOpenActivity: (() -> Void)?
    /// Set when this build can update itself.
    var onCheckForUpdates: (() -> Void)?
    /// The updater's last result, shown under the version.
    var updateStatus: String?

    private let engine: ArenaEngine
    private let frontApp: FrontAppSensor
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var status: StatusPayload?

    init(engine: ArenaEngine, frontApp: FrontAppSensor) {
        self.engine = engine
        self.frontApp = frontApp
        super.init()
        statusItem.button?.imagePosition = .imageLeading
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        refreshTitle()
    }

    func update(status: StatusPayload) {
        self.status = status
        refreshTitle()
    }

    /// "4h 12m · 9h 40m" — human time, then agent time, today. The flame turns
    /// into a star with a dot while a quest offer waits for an answer.
    func refreshTitle() {
        let summary = engine.todaySummary()
        let questOffered = !QuestStatus.forMenu(status?.quests ?? []).offered.isEmpty
        statusItem.button?.image = questOffered ? Self.questOfferedIcon : Self.flameIcon
        statusItem.button?.title = " \(Format.duration(summary.humanSeconds)) · \(Format.duration(Int(summary.agentSeconds)))"
        statusItem.button?.toolTip = questOffered
            ? "Arena — a new quest is waiting for you"
            : "Arena — human time · agent time today"
    }

    private static let flameIcon: NSImage? = {
        let image = NSImage(systemSymbolName: "flame", accessibilityDescription: "Arena")
        image?.isTemplate = true
        return image
    }()

    /// An orange star with a red dot at its top right. Not a template image, so
    /// it keeps its colours on light and dark menu bars.
    private static let questOfferedIcon: NSImage? = {
        let config = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.systemOrange]))
        guard let star = NSImage(systemSymbolName: "star.fill", accessibilityDescription: "Arena: new quest offered")?
            .withSymbolConfiguration(config) else { return nil }
        let size = NSSize(width: star.size.width + 4, height: max(star.size.height, 16))
        let image = NSImage(size: size, flipped: false) { rect in
            star.draw(in: NSRect(x: 0, y: (rect.height - star.size.height) / 2, width: star.size.width, height: star.size.height))
            let dot: CGFloat = 6
            NSColor.systemRed.setFill()
            NSBezierPath(ovalIn: NSRect(x: rect.width - dot, y: rect.height - dot, width: dot, height: dot)).fill()
            return true
        }
        image.isTemplate = false
        image.accessibilityDescription = "Arena: new quest offered"
        return image
    }()

    func showMessage(_ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Arena"
        alert.informativeText = text
        alert.runModal()
    }

    // MARK: - Menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let summary = engine.todaySummary()
        let settings = engine.currentSettings()

        // Header: version and update state.
        menu.addItem(label("Arena \(ArenaEngine.version)" + (onCheckForUpdates != nil ? "  ·  \(updateStatus ?? "Not checked yet")" : "")))
        if let onCheckForUpdates {
            menu.addItem(action("Check for Updates", key: "u") { onCheckForUpdates() })
        }
        menu.addItem(.separator())
        menu.addItem(label("Human \(Format.duration(summary.humanSeconds))  ·  Agents \(Format.duration(Int(summary.agentSeconds)))  ·  Meetings \(Format.duration(summary.meetingSeconds))"))
        if summary.agentsWorkingNow > 0 {
            menu.addItem(label("\(summary.agentsWorkingNow) agent chat\(summary.agentsWorkingNow == 1 ? "" : "s") working now"))
        }
        if settings.isPaused(at: Date()) {
            menu.addItem(label(pausedText(settings.pausedUntil)))
        }
        menu.addItem(action("Your Activity…", key: "a") { [weak self] in self?.onOpenActivity?() })

        menu.addItem(.separator())
        addProgress(to: menu)
        addQuests(to: menu)

        if !summary.topApps.isEmpty {
            menu.addItem(.separator())
            menu.addItem(label("Top apps today", bold: true))
            for app in summary.topApps.prefix(Self.topAppCount) {
                let name = app.bundleId == "private" ? "Private apps" : app.appName
                menu.addItem(label("\(name)  \(Format.duration(app.sec))"))
            }
        }
        if !summary.topTitles.isEmpty {
            menu.addItem(label("Top windows today (on this Mac only)", bold: true))
            for window in summary.topTitles {
                menu.addItem(label("\(String(window.title.prefix(48)))  \(Format.duration(window.sec))"))
            }
        }

        menu.addItem(.separator())
        menu.addItem(pauseMenu(settings))
        menu.addItem(privacyMenu(settings))
        menu.addItem(connectionMenu(settings))
        if let url = status?.dashboardUrl.flatMap(URL.init(string:)) ?? settings.serverURL {
            menu.addItem(action("Open Dashboard", key: "d") { NSWorkspace.shared.open(url) })
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Arena", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func addProgress(to menu: NSMenu) {
        guard let user = status?.user else {
            if engine.currentSettings().serverURL == nil {
                menu.addItem(action("Connect to Arena…") { [weak self] in self?.onConnectInBrowser?() })
            } else {
                menu.addItem(label("Waiting for first sync…"))
            }
            return
        }
        if let level = user.level {
            let xp = user.xp.map { "\(Format.number($0))" } ?? "–"
            let next = user.xpForNext.map { " / \(Format.number($0)) XP" } ?? " XP"
            menu.addItem(label("Level \(level)  ·  \(xp)\(next)", bold: true))
        }
        var parts: [String] = []
        if let league = user.league { parts.append("\(league.capitalized) League") }
        if let rank = user.weeklyRank { parts.append("#\(rank)" + (user.weeklyOf.map { " of \($0)" } ?? "")) }
        if let xpToday = status?.today?.xp { parts.append("+\(Format.number(xpToday)) XP today") }
        if !parts.isEmpty { menu.addItem(label(parts.joined(separator: "  ·  "))) }
    }

    static let topAppCount = 2

    private func addQuests(to menu: NSMenu) {
        let (offered, active) = QuestStatus.forMenu(status?.quests ?? [])
        guard !offered.isEmpty || !active.isEmpty else { return }
        menu.addItem(.separator())
        menu.addItem(label("Quests", bold: true))
        for quest in offered {
            menu.addItem(label("New: \(quest.title)  (+\(quest.xp) XP)"))
            menu.addItem(action("    Accept") { [weak self] in self?.onQuestResponse?(quest.id, true) })
            menu.addItem(action("    Decline") { [weak self] in self?.onQuestResponse?(quest.id, false) })
        }
        for quest in active {
            menu.addItem(label("\(quest.title)  \(Format.progress(quest))  (+\(quest.xp) XP)"))
        }
    }

    private func pauseMenu(_ settings: ArenaSettings) -> NSMenuItem {
        let item = NSMenuItem(title: "Pause Tracking", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        if settings.isPaused(at: Date()) {
            sub.addItem(action("Resume Now") { [weak self] in self?.engine.updateSettings { $0.pausedUntil = nil } })
        }
        for (title, seconds) in [("For 30 Minutes", 1800.0), ("For 1 Hour", 3600.0)] {
            sub.addItem(action(title) { [weak self] in
                self?.engine.updateSettings { $0.pausedUntil = Date().addingTimeInterval(seconds) }
            })
        }
        sub.addItem(action("Until I Resume") { [weak self] in self?.engine.updateSettings { $0.pausedUntil = .distantFuture } })
        item.submenu = sub
        return item
    }

    private func privacyMenu(_ settings: ArenaSettings) -> NSMenuItem {
        let item = NSMenuItem(title: "Privacy", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        if let app = frontApp.current, app.bundleId != Bundle.main.bundleIdentifier, !settings.privateApps.contains(app.bundleId) {
            sub.addItem(action("Mark “\(app.name)” Private") { [weak self] in
                self?.engine.updateSettings { $0.privateApps.insert(app.bundleId) }
            })
        }
        if !settings.privateApps.isEmpty {
            sub.addItem(label("Private apps (click to unmark)"))
            for bundleId in settings.privateApps.sorted() {
                sub.addItem(action("    \(bundleId)") { [weak self] in
                    self?.engine.updateSettings { $0.privateApps.remove(bundleId) }
                })
            }
        }
        sub.addItem(.separator())
        let titles = action("Track Window Titles (stay on this Mac)") { [weak self] in
            let enable = !settings.windowTitlesEnabled
            if enable && !WindowTitleSensor.isTrusted { WindowTitleSensor.requestAccess() }
            self?.engine.updateSettings { $0.windowTitlesEnabled = enable }
        }
        titles.state = settings.windowTitlesEnabled ? .on : .off
        sub.addItem(titles)
        let calendarItem = action("Count Calendar Meetings") { [weak self] in self?.onToggleCalendar?() }
        calendarItem.state = settings.calendarEnabled ? .on : .off
        sub.addItem(calendarItem)
        sub.addItem(.separator())
        sub.addItem(historyMenu(settings))
        sub.addItem(deleteOlderMenu())
        sub.addItem(action("Delete All Local History…") { [weak self] in self?.confirmDeleteAll() })
        item.submenu = sub
        return item
    }

    /// "Keep History" choices; history on this Mac is kept forever unless one is picked.
    private func historyMenu(_ settings: ArenaSettings) -> NSMenuItem {
        let item = NSMenuItem(title: "Keep History", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (title, days) in [("Forever", nil), ("1 Year", 365), ("90 Days", 90), ("30 Days", 30)] as [(String, Int?)] {
            let choice = action(title) { [weak self] in self?.engine.updateSettings { $0.historyKeepDays = days } }
            choice.state = settings.historyKeepDays == days ? .on : .off
            sub.addItem(choice)
        }
        item.submenu = sub
        return item
    }

    private func deleteOlderMenu() -> NSMenuItem {
        let item = NSMenuItem(title: "Delete History Older Than", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (title, days) in [("30 Days…", 30), ("90 Days…", 90), ("1 Year…", 365)] {
            sub.addItem(action(title) { [weak self] in
                guard self?.confirm("Delete history older than \(title.dropLast())?",
                                    "Activity older than that is removed from this Mac. Your Arena dashboard keeps what it already has.") == true
                else { return }
                self?.engine.deleteHistory(olderThanDays: days)
            })
        }
        item.submenu = sub
        return item
    }

    private func confirmDeleteAll() {
        guard confirm("Delete all local history?",
                      "Every app, call and agent minute stored on this Mac is removed, along with anything not yet uploaded. Your Arena dashboard keeps what it already has. This can’t be undone.")
        else { return }
        engine.deleteAllHistory()
    }

    private func confirm(_ title: String, _ text: String) -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Delete")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func connectionMenu(_ settings: ArenaSettings) -> NSMenuItem {
        let item = NSMenuItem(title: "Connection", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        sub.addItem(label(settings.serverURL.map { "Server: \($0.host ?? $0.absoluteString)" } ?? "Not connected"))
        sub.addItem(action("Connect to Arena…") { [weak self] in self?.onConnectInBrowser?() })
        sub.addItem(action("Paste Pairing Link…") { [weak self] in self?.askForPairingLink() })
        sub.addItem(.separator())
        switch engine.linearState {
        case .off:
            sub.addItem(action("Connect Linear…") { [weak self] in self?.askForLinearKey() })
        case .badKey:
            sub.addItem(label("Linear: key rejected"))
            sub.addItem(action("Replace Linear Key…") { [weak self] in self?.askForLinearKey() })
            sub.addItem(action("Disconnect Linear") { [weak self] in self?.onDisconnectLinear?() })
        case .synced(let at):
            sub.addItem(label(at.map { "Linear: synced \(DateFormatter.localizedString(from: $0, dateStyle: .none, timeStyle: .short))" } ?? "Linear: connected"))
            sub.addItem(action("Disconnect Linear") { [weak self] in self?.onDisconnectLinear?() })
        }
        item.submenu = sub
        return item
    }

    private func askForLinearKey() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Connect Linear"
        alert.informativeText = "Paste a personal API key from Linear (Settings → Security & access). It stays in this Mac’s Keychain. Arena only sends each closed issue’s number, estimate and time to the leaderboard."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        field.placeholderString = "lin_api_…"
        alert.accessoryView = field
        alert.addButton(withTitle: "Connect")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            let key = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty { onConnectLinear?(key) }
        }
    }

    /// For builds without a built-in website: asks for its address.
    func askForServerAddress() -> URL? {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Connect to Arena"
        alert.informativeText = "Enter your team’s Arena website address."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        field.placeholderString = "https://arena.example.com"
        alert.accessoryView = field
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        var text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), url.scheme == "https" || url.scheme == "http", url.host != nil else {
            showMessage("That isn’t a website address.")
            return nil
        }
        return url
    }

    private func askForPairingLink() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Connect this Mac"
        alert.informativeText = "Paste the arena://pair link from the Connect page of the Arena dashboard."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        field.placeholderString = "arena://pair?server=…&token=…"
        // Fill in a copied link so there's nothing to paste.
        if let copied = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           copied.hasPrefix("arena://pair") {
            field.stringValue = copied
        }
        alert.accessoryView = field
        alert.addButton(withTitle: "Connect")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            onPair?(field.stringValue)
        }
    }

    private func pausedText(_ until: Date?) -> String {
        guard let until, until != .distantFuture else { return "Tracking paused" }
        return "Tracking paused until \(DateFormatter.localizedString(from: until, dateStyle: .none, timeStyle: .short))"
    }

    // MARK: - Item helpers

    private func label(_ title: String, bold: Bool = false) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        if bold {
            item.attributedTitle = NSAttributedString(string: title, attributes: [.font: NSFont.boldSystemFont(ofSize: 13)])
        }
        return item
    }

    private func action(_ title: String, key: String = "", _ handler: @escaping () -> Void) -> NSMenuItem {
        let item = ClosureMenuItem(title: title, keyEquivalent: key, handler: handler)
        return item
    }
}

/// NSMenuItem that runs a closure.
private final class ClosureMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(title: String, keyEquivalent: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: keyEquivalent)
        target = self
    }

    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func run() { handler() }
}

enum Format {
    static func duration(_ seconds: Int) -> String {
        let minutes = seconds / 60
        return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
    }

    static func number(_ n: Int) -> String {
        n >= 10_000 ? String(format: "%.1fK", Double(n) / 1000) : "\(n)"
    }

    static func progress(_ quest: QuestStatus) -> String {
        guard let target = quest.target, target > 0 else { return "" }
        let progress = quest.progress ?? 0
        if quest.unit == "sec" {
            return "\(duration(Int(progress))) / \(duration(Int(target)))"
        }
        return "\(Int(progress)) / \(Int(target))"
    }
}

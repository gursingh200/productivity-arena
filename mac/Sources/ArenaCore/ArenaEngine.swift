import Foundation

/// Coordinates tracking, local storage and upload. Platform code (sensors,
/// menu bar) talks only to this class. Every store access runs on `queue`.
public final class ArenaEngine: @unchecked Sendable {

    /// The app's version from its Info.plist (0.1.0 outside an app bundle).
    public static let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    /// The app's build number (CFBundleVersion); updates compare this.
    public static let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    static let openCodeMinInterval: TimeInterval = 15
    static let cursorMinInterval: TimeInterval = 10 * 60

    public let queue = DispatchQueue(label: "io.clueso.arena.engine", qos: .utility)
    private let store: Store
    private let tracker: AgentTracker
    private let human: HumanRecorder
    private let paths: AgentPaths
    private let client: ArenaClient
    private let device: DeviceInfo

    private var settings: ArenaSettings {
        didSet { snapshotLock.withLock { settingsSnapshot = settings } }
    }
    /// Copies the main thread reads without waiting on `queue`, which can be
    /// busy for a while (first-run backfill, migrations). Guarded by `snapshotLock`.
    private let snapshotLock = NSLock()
    private var settingsSnapshot: ArenaSettings
    private var summarySnapshot = Summary(humanSeconds: 0, meetingSeconds: 0, agentSeconds: 0, agentsWorkingNow: 0, topApps: [], topTitles: [])
    private var backoff = Backoff()
    private var uploading = false
    private var lastOpenCodeScan = Date.distantPast
    private var lastCursorScan = Date.distantPast

    /// Latest status from the server; delivered on the main queue.
    public var onStatus: ((StatusPayload) -> Void)?
    public private(set) var lastStatus: StatusPayload?
    /// When the server last sent a status. Guarded by `queue`.
    private var lastStatusAt = Date.distantPast
    /// With nothing to upload, ask for status at most this often. Every ingest
    /// already returns a status, and polling more would keep a serverless
    /// database (e.g. Neon's free tier) from ever going idle.
    static let idleStatusInterval: TimeInterval = 30 * 60

    public init(store: Store, paths: AgentPaths = AgentPaths(), token: String?, device: (String) -> DeviceInfo) throws {
        self.store = store
        self.paths = paths
        self.tracker = AgentTracker(store: store, paths: paths)
        self.human = HumanRecorder(store: store)
        let loaded = try ArenaSettings.load(from: store)
        self.settings = loaded
        self.settingsSnapshot = loaded
        self.client = ArenaClient(serverURL: settings.serverURL, token: token)
        self.device = device(settings.deviceId)
    }

    // MARK: - Agent logs

    /// Directories the platform should watch for changes.
    public func watchedDirectories() -> [String] {
        let logRoots = jsonlAgentSources.flatMap { $0.roots(paths) }
        let dbDirs = tracker.databasePaths().map { ($0 as NSString).deletingLastPathComponent }
            .filter { FileManager.default.fileExists(atPath: $0) }
        return logRoots + dbDirs
    }

    /// Reads everything new in all agent logs. Runs the 7-day backfill on first launch.
    /// Each file is its own queue item so the menu bar never waits long behind a backfill.
    public func scanEverything() {
        queue.async { [self] in
            log { try tracker.mergeClaudeSubagents() }
            for source in jsonlAgentSources {
                for file in tracker.sessionFiles(for: source) {
                    queue.async { [self] in log { try tracker.processFile(file, source: source) } }
                }
            }
            queue.async { [self] in
                scanDatabases(force: true)
                log { try store.prune(keepDays: settings.historyKeepDays) }
            }
        }
    }

    /// Handles paths reported by the file watcher.
    public func filesChanged(_ changed: [String]) {
        queue.async { [self] in
            var databaseTouched = false
            for path in Set(changed) {
                if let source = tracker.source(forFile: path) {
                    log { try tracker.processFile(path, source: source) }
                } else {
                    databaseTouched = true
                }
            }
            if databaseTouched { scanDatabases(force: false) }
        }
    }

    private func scanDatabases(force: Bool) {
        let now = Date()
        if force || now.timeIntervalSince(lastOpenCodeScan) >= Self.openCodeMinInterval {
            lastOpenCodeScan = now
            log { try tracker.scanOpenCode() }
        }
        if force || now.timeIntervalSince(lastCursorScan) >= Self.cursorMinInterval {
            lastCursorScan = now
            log { try tracker.scanCursor() }
        }
    }

    /// Credits agents found busy by the process-scan fallback.
    public func busyProcesses(_ agents: Set<String>, at now: Date = Date()) {
        guard !agents.isEmpty else { return }
        // The scan measured the last minute, so credit the minute that just ended.
        let minute = minuteOf(now) - 60
        queue.async { [self] in log { try tracker.recordBusyProcesses(agents, minute: minute) } }
    }

    // MARK: - Human activity

    /// - Parameter micCapturing: bundle ids of processes capturing the microphone right now.
    public func tick(now: Date, idleSeconds: TimeInterval, app: FrontApp?, windowTitle: String?, locked: Bool,
                     micCapturing: [String] = []) {
        queue.async { [self] in
            let suspended = locked || settings.isPaused(at: now)
            let title = settings.windowTitlesEnabled ? windowTitle : nil
            let tick = HumanRecorder.Tick(now: now, idleSeconds: idleSeconds, app: app, windowTitle: title, suspended: suspended,
                                          mic: MicApps.classify(micCapturing))
            log { try human.record(tick, privateApps: settings.privateApps) }
            updateSummary(now: now)
        }
    }

    /// Call after sleep or unlock so the gap isn't counted.
    public func resetHumanClock() {
        queue.async { [self] in human.reset() }
    }

    // MARK: - Settings

    /// Latest settings; safe to call from the main thread.
    public func currentSettings() -> ArenaSettings {
        snapshotLock.withLock { settingsSnapshot }
    }

    public func updateSettings(_ change: @escaping (inout ArenaSettings) -> Void) {
        queue.async { [self] in
            let before = settings
            change(&settings)
            for app in settings.privateApps.subtracting(before.privateApps) {
                log { try store.deleteAppHistory(bundleId: app) }
            }
            client.serverURL = settings.serverURL
            log { try settings.save(to: store) }
        }
    }

    public func setToken(_ token: String?) {
        queue.async { [self] in client.token = token }
    }

    // MARK: - Local history

    /// Deletes local history older than `days` days. The server keeps what it has.
    public func deleteHistory(olderThanDays days: Int) {
        queue.async { [self] in
            log { try store.deleteHistory(before: Date().addingTimeInterval(-Double(days) * 86_400)) }
            updateSummary(now: Date())
        }
    }

    /// Deletes all local activity history. The server keeps what it has.
    public func deleteAllHistory() {
        queue.async { [self] in
            log { try store.deleteAllHistory() }
            updateSummary(now: Date())
        }
    }

    /// Builds the activity dashboard's report for `interval` on the engine queue
    /// and delivers it on the main queue.
    public func activityReport(for interval: DateInterval, calendar: Calendar = .current,
                               completion: @escaping (ActivityReport) -> Void) {
        queue.async { [self] in
            let report = (try? ActivityReport.build(store: store, interval: interval, calendar: calendar))
                ?? ActivityReport.empty(interval: interval, calendar: calendar)
            DispatchQueue.main.async { completion(report) }
        }
    }

    // MARK: - Summary for the menu bar

    public struct Summary {
        public var humanSeconds: Int
        public var meetingSeconds: Int
        public var agentSeconds: Double
        public var agentsWorkingNow: Int
        public var topApps: [Store.AppSeconds]
        public var topTitles: [(title: String, sec: Int)]
    }

    /// Today's totals as of the last tick (at most ~5 s old); safe to call from the main thread.
    public func todaySummary() -> Summary {
        snapshotLock.withLock { summarySnapshot }
    }

    /// Recomputes today's totals. Runs on `queue`.
    private func updateSummary(now: Date) {
        let start = minuteOf(Calendar.current.startOfDay(for: now))
        let end = minuteOf(now)
        let summary = Summary(
            humanSeconds: (try? store.humanSeconds(from: start, to: end)) ?? 0,
            meetingSeconds: (try? store.meetingTotal(from: start, to: end)) ?? 0,
            agentSeconds: (try? store.agentSeconds(from: start, to: end)) ?? 0,
            agentsWorkingNow: (try? store.activeSessionCount(from: end - 120, to: end)) ?? 0,
            topApps: Array(((try? store.appTotals(from: start, to: end)) ?? []).prefix(5)),
            topTitles: settings.windowTitlesEnabled ? ((try? store.titleTotals(from: start, to: end, limit: 5)) ?? []) : [])
        snapshotLock.withLock { summarySnapshot = summary }
    }

    // MARK: - Upload and quests

    /// Uploads all dirty data in batches, then publishes the returned status.
    public func upload() async {
        let canStart: Bool = queue.sync {
            guard !uploading, backoff.allows(Date()), client.token != nil, client.serverURL != nil else { return false }
            uploading = true
            return true
        }
        guard canStart else { return }
        defer { queue.sync { uploading = false } }

        while true {
            guard let built = queue.sync(execute: { try? PayloadBuilder.build(store: store, device: device) }) else { return }
            if built.isEmpty {
                let due = queue.sync { Date().timeIntervalSince(lastStatusAt) >= Self.idleStatusInterval }
                if due { await refreshStatus() }
                return
            }
            do {
                let response = try await client.ingest(built.payload)
                queue.sync {
                    log { try store.clearDirtyMinutes(built.minutes) }
                    log { try store.clearDirtyChats(built.chats) }
                    log { try store.clearDeletedChats(built.deletedChats) }
                    backoff.succeeded()
                }
                if let status = response.status { publish(status) }
            } catch {
                queue.sync { backoff.failed(at: Date()) }
                return
            }
        }
    }

    public func refreshStatus() async {
        if let status = try? await client.status() { publish(status) }
    }

    public func respondToQuest(id: String, accept: Bool) async {
        do {
            if accept { try await client.acceptQuest(id) } else { try await client.declineQuest(id) }
        } catch {
            return
        }
        await refreshStatus()
    }

    private func publish(_ status: StatusPayload) {
        queue.sync {
            lastStatus = status
            lastStatusAt = Date()
        }
        DispatchQueue.main.async { self.onStatus?(status) }
    }

    // MARK: - Linear

    /// The Linear API key from the Keychain; nil when Linear isn't connected.
    public var linearKey: String? {
        get { snapshotLock.withLock { _linearKey } }
        set { snapshotLock.withLock { _linearKey = newValue } }
    }
    private var _linearKey: String?
    static let linearSyncedKey = "linear.lastSyncedAt"

    public enum LinearState: Equatable, Sendable {
        case off
        case synced(Date?)
        case badKey
    }
    /// For the menu; read on the main thread.
    public var linearState: LinearState {
        snapshotLock.withLock { _linearKey == nil ? .off : (_linearBadKey ? .badKey : .synced(_linearSyncedAt)) }
    }
    private var _linearBadKey = false
    private var _linearSyncedAt: Date?

    /// Fetches assigned issues from Linear and reports them, at most every 15 minutes
    /// unless forced. Throws `LinearError.badKey` when Linear rejects the key.
    public func syncLinear(force: Bool = false, now: Date = Date()) async throws {
        guard let key = linearKey, client.token != nil, client.serverURL != nil else { return }
        let last = queue.sync { (try? store.value(Self.linearSyncedKey)).flatMap { $0 }.flatMap(Double.init).map(Date.init(timeIntervalSince1970:)) }
        snapshotLock.withLock { _linearSyncedAt = last }
        if !force, let last, now.timeIntervalSince(last) < LinearAPI.syncInterval { return }
        do {
            let issues = try await LinearAPI.assignedIssues(apiKey: key, since: LinearAPI.since(lastSync: last, now: now))
            try await client.reportLinear(issues)
        } catch LinearError.badKey {
            snapshotLock.withLock { _linearBadKey = true }
            throw LinearError.badKey
        }
        queue.sync { log { try store.setValue(String(now.timeIntervalSince1970), for: Self.linearSyncedKey) } }
        snapshotLock.withLock { _linearBadKey = false; _linearSyncedAt = now }
    }

    /// Uses a new key, starting again from a full first sync.
    public func setLinearKey(_ key: String?) {
        linearKey = key
        snapshotLock.withLock { _linearBadKey = false; _linearSyncedAt = nil }
        queue.sync { log { try store.setValue(nil, for: Self.linearSyncedKey) } }
    }

    /// Forgets the key and tells the server Linear is disconnected. XP already earned stays.
    public func disconnectLinear() async {
        setLinearKey(nil)
        try? await client.disconnectLinear()
    }

    // MARK: - Errors

    /// Tracking must never crash the app; failures are logged and skipped.
    private func log(_ body: () throws -> Void) {
        do { try body() } catch { NSLog("Arena: %@", String(describing: error)) }
    }
}

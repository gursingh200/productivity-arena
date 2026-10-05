import AppKit
import ArenaCore
import ArenaMac
import Foundation
import Security

/// Polls the releases repo's latest release and installs newer builds.
///
/// A new build is installed only if (1) the zip matches latest.json's SHA-256,
/// (2) its Ed25519 signature verifies against the public key in this app's
/// Info.plist, and (3) the unzipped app is signed by the same certificate,
/// with the same identifier, as the running app (its designated requirement).
/// Then the running bundle is swapped for the new one and relaunched.
@MainActor
final class Updater {

    static let checkInterval: TimeInterval = 3600
    static let firstCheckDelay: TimeInterval = 5

    /// One line for the menu, e.g. "Up to date (checked 10:42)".
    private(set) var status = "Checking for updates…"
    var onChange: (() -> Void)?

    private let config: UpdateConfig
    private let currentBuild: Int
    private var busy = false
    private var timer: Timer?

    /// Nil when this build has no update repo or key (local development builds).
    init?(bundle: Bundle = .main) {
        guard let info = bundle.infoDictionary, let config = UpdateConfig(info: info) else { return nil }
        self.config = config
        self.currentBuild = Int(info["CFBundleVersion"] as? String ?? "") ?? 0
        Self.removeOldBundles(near: bundle.bundleURL)
    }

    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.firstCheckDelay) { [weak self] in self?.check() }
        let timer = Timer(timeInterval: Self.checkInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
        timer.tolerance = 300
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func check() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await checkAndInstall()
            } catch {
                NSLog("Arena update: %@", String(describing: error))
                set("Update failed: \(error)")
            }
        }
    }

    // MARK: - Steps

    private func checkAndInstall() async throws {
        let manifest = try ReleaseManifest.parse(try await fetch(config.manifestURL))
        switch UpdatePolicy.decide(manifest, currentBuild: currentBuild, system: ProcessInfo.processInfo.operatingSystemVersion) {
        case .upToDate:
            set("Up to date (checked \(Self.time.string(from: Date())))")
            return
        case .needsNewerSystem(let minimum):
            set("Arena \(manifest.version) needs macOS \(minimum)")
            return
        case .update:
            break
        }

        let current = Bundle.main.bundleURL
        guard !current.path.contains("/AppTranslocation/"),
              FileManager.default.isWritableFile(atPath: current.deletingLastPathComponent().path) else {
            set("Move Arena to Applications to get updates")
            return
        }

        set("Downloading Arena \(manifest.version)…")
        let zip = try await fetch(config.zipURL(for: manifest))
        try UpdatePolicy.verify(zip: zip, manifest: manifest, publicKey: config.publicKey)

        let work = FileManager.default.temporaryDirectory.appendingPathComponent("arena-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: work) }
        let zipFile = work.appendingPathComponent(manifest.zip)
        try zip.write(to: zipFile)
        try run("/usr/bin/ditto", ["-x", "-k", zipFile.path, work.path])
        guard let newApp = try FileManager.default.contentsOfDirectory(at: work, includingPropertiesForKeys: nil)
                .first(where: { $0.pathExtension == "app" }) else { throw UpdaterError.noAppInZip }
        try Self.requireSameSigner(newApp)

        try install(newApp, replacing: current)
        // Hand the Keychain secrets to the new build so it isn't asked for a password.
        do {
            try KeychainHandoff.prepare(directory: URL(fileURLWithPath: Store.defaultPath()).deletingLastPathComponent())
        } catch {
            NSLog("Arena update: Keychain handoff failed: %@", String(describing: error))
        }
        set("Restarting into Arena \(manifest.version)…")
        relaunch(current)
    }

    private func fetch(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.setValue("Arena/\(ArenaEngine.version)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw UpdaterError.http(code, url.lastPathComponent) }
        return data
    }

    /// The new app must satisfy the running app's designated requirement:
    /// same bundle identifier and same signing certificate.
    private static func requireSameSigner(_ app: URL) throws {
        var me: SecCode?
        var meStatic: SecStaticCode?
        var requirement: SecRequirement?
        guard SecCodeCopySelf([], &me) == errSecSuccess, let me,
              SecCodeCopyStaticCode(me, [], &meStatic) == errSecSuccess, let meStatic,
              SecCodeCopyDesignatedRequirement(meStatic, [], &requirement) == errSecSuccess,
              let requirement else { throw UpdaterError.signature("can't read this app's signature") }
        var candidate: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &candidate) == errSecSuccess, let candidate else {
            throw UpdaterError.signature("can't read the new app's signature")
        }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode)
        let result = SecStaticCodeCheckValidity(candidate, flags, requirement)
        guard result == errSecSuccess else { throw UpdaterError.signature("new app isn't signed like this one (\(result))") }
    }

    /// Moves the running bundle aside and the new one into its place; rolls back on failure.
    private func install(_ newApp: URL, replacing current: URL) throws {
        let fm = FileManager.default
        let aside = current.deletingLastPathComponent()
            .appendingPathComponent(".\(current.deletingPathExtension().lastPathComponent)-old-\(UUID().uuidString).app")
        try fm.moveItem(at: current, to: aside)
        do {
            try fm.moveItem(at: newApp, to: current)
        } catch {
            try? fm.moveItem(at: aside, to: current)
            throw error
        }
    }

    /// Opens the new bundle once this process has exited, then quits.
    private func relaunch(_ app: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", app.path]
        try? process.run()
        NSApp.terminate(nil)
    }

    /// Bundles moved aside by a previous update.
    private static func removeOldBundles(near current: URL) {
        let dir = current.deletingLastPathComponent()
        let prefix = ".\(current.deletingPathExtension().lastPathComponent)-old-"
        for item in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where item.hasPrefix(prefix) {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(item))
        }
    }

    private func run(_ tool: String, _ args: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw UpdaterError.tool(tool, process.terminationStatus) }
    }

    private func set(_ text: String) {
        status = text
        onChange?()
    }

    private static let time: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()
}

enum UpdaterError: Error, CustomStringConvertible {
    case http(Int, String)
    case noAppInZip
    case signature(String)
    case tool(String, Int32)

    var description: String {
        switch self {
        case .http(let code, let file): return "\(file) returned HTTP \(code)"
        case .noAppInZip: return "the download has no app in it"
        case .signature(let why): return why
        case .tool(let tool, let code): return "\(tool) exited with \(code)"
        }
    }
}

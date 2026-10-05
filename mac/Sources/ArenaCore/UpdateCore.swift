import CryptoKit
import Foundation

/// Self-update from a public GitHub releases repo, the pure parts (no AppKit,
/// no network). The app polls `latest.json` from the repo's latest release,
/// and installs a newer build only if the zip matches its SHA-256 and its
/// Ed25519 signature checks out against the public key built into the app.

/// `latest.json`, published next to the zip in every release.
public struct ReleaseManifest: Codable, Equatable, Sendable {
    public var version: String
    public var build: Int
    public var zip: String
    public var sha256: String
    public var signature: String
    public var minimumSystemVersion: String

    public init(version: String, build: Int, zip: String, sha256: String, signature: String, minimumSystemVersion: String) {
        self.version = version
        self.build = build
        self.zip = zip
        self.sha256 = sha256
        self.signature = signature
        self.minimumSystemVersion = minimumSystemVersion
    }

    public static func parse(_ data: Data) throws -> ReleaseManifest {
        let manifest = try JSONDecoder().decode(ReleaseManifest.self, from: data)
        guard manifest.build > 0 else { throw UpdateError.invalidManifest("build must be positive") }
        // Both end up in a URL path; allow only plain release-style names.
        guard manifest.version.range(of: #"^[0-9A-Za-z.+-]+$"#, options: .regularExpression) != nil else {
            throw UpdateError.invalidManifest("bad version")
        }
        guard manifest.zip.range(of: #"^[0-9A-Za-z._+-]+\.zip$"#, options: .regularExpression) != nil,
              !manifest.zip.contains("..") else {
            throw UpdateError.invalidManifest("bad zip name")
        }
        return manifest
    }
}

public enum UpdateError: Error, Equatable, CustomStringConvertible {
    case invalidManifest(String)
    case checksumMismatch
    case badSignature
    case invalidPublicKey

    public var description: String {
        switch self {
        case .invalidManifest(let why): return "invalid latest.json (\(why))"
        case .checksumMismatch: return "download doesn't match its checksum"
        case .badSignature: return "download isn't signed with this app's update key"
        case .invalidPublicKey: return "the app's update key is invalid"
        }
    }
}

/// Where updates come from, read from the app's Info.plist. Nil when the build
/// has no update repo or key (local development builds): the updater is off.
public struct UpdateConfig: Equatable, Sendable {
    public var repo: String
    public var publicKey: Data
    public var baseURL: URL

    public init?(info: [String: Any]) {
        guard let repo = info["ArenaUpdateRepo"] as? String,
              repo.range(of: #"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil,
              let keyString = info["ArenaUpdatePublicKey"] as? String,
              let key = Data(base64Encoded: keyString), key.count == 32 else { return nil }
        self.repo = repo
        self.publicKey = key
        // Overridable only for testing against a local server.
        self.baseURL = (info["ArenaUpdateBaseURL"] as? String).flatMap(URL.init(string:)) ?? URL(string: "https://github.com")!
    }

    /// GitHub's "latest release" download redirect: no API rate limits.
    public var manifestURL: URL {
        baseURL.appendingPathComponent(repo).appendingPathComponent("releases/latest/download/latest.json")
    }

    public func zipURL(for manifest: ReleaseManifest) -> URL {
        baseURL.appendingPathComponent(repo).appendingPathComponent("releases/download/v\(manifest.version)/\(manifest.zip)")
    }
}

public enum UpdateDecision: Equatable, Sendable {
    case upToDate
    case update(ReleaseManifest)
    case needsNewerSystem(String)
}

public enum UpdatePolicy {
    /// Newer means a higher build number; versions are labels.
    public static func decide(_ manifest: ReleaseManifest, currentBuild: Int,
                              system: OperatingSystemVersion) -> UpdateDecision {
        guard manifest.build > currentBuild else { return .upToDate }
        guard isAtLeast(system, manifest.minimumSystemVersion) else {
            return .needsNewerSystem(manifest.minimumSystemVersion)
        }
        return .update(manifest)
    }

    static func isAtLeast(_ system: OperatingSystemVersion, _ minimum: String) -> Bool {
        let parts = minimum.split(separator: ".").map { Int($0) ?? 0 }
        let need = (parts.count > 0 ? parts[0] : 0, parts.count > 1 ? parts[1] : 0, parts.count > 2 ? parts[2] : 0)
        let have = (system.majorVersion, system.minorVersion, system.patchVersion)
        return have >= need
    }

    /// Checks a downloaded zip against the manifest and the app's public key.
    public static func verify(zip data: Data, manifest: ReleaseManifest, publicKey: Data) throws {
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == manifest.sha256.lowercased() else { throw UpdateError.checksumMismatch }
        guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKey) else {
            throw UpdateError.invalidPublicKey
        }
        guard let signature = Data(base64Encoded: manifest.signature),
              key.isValidSignature(signature, for: data) else { throw UpdateError.badSignature }
    }
}

import Foundation

/// Carries Arena's Keychain secrets across a self-update without a password prompt.
///
/// Arena isn't signed with an Apple Team ID, so macOS ties each Keychain item to
/// the exact build that created it, and asks for the login password when a new
/// build reads it. So just before relaunching into an update, the running app
/// (which can read its items) moves them into an owner-only file and deletes the
/// items; the new build saves them again as its own on launch and deletes the
/// file. The file exists for a few seconds.
public enum KeychainHandoff {
    struct Secrets: Codable {
        var token: String?
        var linearKey: String?
    }

    static func file(in directory: URL) -> URL { directory.appendingPathComponent("keychain-handoff.json") }

    /// Called by the running app right before it relaunches into an update.
    public static func prepare(directory: URL) throws {
        let secrets = Secrets(token: Keychain.loadToken(), linearKey: Keychain.loadLinearKey())
        guard secrets.token != nil || secrets.linearKey != nil else { return }
        let url = file(in: directory)
        try? FileManager.default.removeItem(at: url)
        guard FileManager.default.createFile(atPath: url.path, contents: try JSONEncoder().encode(secrets),
                                             attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        Keychain.deleteToken()
        Keychain.deleteLinearKey()
    }

    /// Called at launch, before reading the Keychain.
    public static func restore(directory: URL) {
        let url = file(in: directory)
        guard let data = try? Data(contentsOf: url) else { return }
        if let secrets = try? JSONDecoder().decode(Secrets.self, from: data) {
            if let token = secrets.token { Keychain.saveToken(token) }
            if let key = secrets.linearKey { Keychain.saveLinearKey(key) }
        }
        try? FileManager.default.removeItem(at: url)
    }
}

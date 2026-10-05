import Foundation
import Security

/// Stores Arena's secrets in the login Keychain: the device token, and the
/// Linear API key, which never leaves this Mac.
public enum Keychain {
    /// Follows the bundle id so a self-hosted build with its own id keeps its own item.
    static let service = Bundle.main.bundleIdentifier ?? "io.clueso.arena"
    static let tokenAccount = "deviceToken"
    static let linearAccount = "linearApiKey"

    public static func saveToken(_ token: String) { save(token, account: tokenAccount) }
    public static func loadToken() -> String? { load(account: tokenAccount) }
    public static func deleteToken() { delete(account: tokenAccount) }

    public static func saveLinearKey(_ key: String) { save(key, account: linearAccount) }
    public static func loadLinearKey() -> String? { load(account: linearAccount) }
    public static func deleteLinearKey() { delete(account: linearAccount) }

    private static func baseQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private static func save(_ value: String, account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
        var query = baseQuery(account)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    private static func load(account: String) -> String? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }
}

import Foundation
import Security

/// Stores the device token in the login Keychain.
public enum Keychain {
    /// Follows the bundle id so a self-hosted build with its own id keeps its own item.
    static let service = Bundle.main.bundleIdentifier ?? "io.clueso.arena"
    static let account = "deviceToken"

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public static func saveToken(_ token: String) {
        SecItemDelete(baseQuery as CFDictionary)
        var query = baseQuery
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    public static func loadToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func deleteToken() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

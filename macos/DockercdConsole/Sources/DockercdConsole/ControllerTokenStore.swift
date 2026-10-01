import Foundation
import Security

protocol ControllerTokenStore: Sendable {
    func token(for profileID: UUID) throws -> String?
    func store(_ token: String, for profileID: UUID) throws
    func deleteToken(for profileID: UUID) throws
}

struct KeychainControllerTokenStore: ControllerTokenStore {
    private static let service = "dev.dockercd.console.controller-token"

    func token(for profileID: UUID) throws -> String? {
        var query = itemQuery(for: profileID)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw ControllerTokenStoreError(operation: "read", status: status)
        }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            throw ControllerTokenStoreError(operation: "read", status: errSecDecode)
        }
        return token
    }

    func store(_ token: String, for profileID: UUID) throws {
        let data = Data(token.utf8)
        let query = itemQuery(for: profileID)
        let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw ControllerTokenStoreError(operation: "update", status: updateStatus)
        }

        var addQuery = query
        addQuery[kSecValueData] = data
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw ControllerTokenStoreError(operation: "store", status: addStatus)
        }
    }

    func deleteToken(for profileID: UUID) throws {
        let status = SecItemDelete(itemQuery(for: profileID) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ControllerTokenStoreError(operation: "delete", status: status)
        }
    }

    private func itemQuery(for profileID: UUID) -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: Self.service,
            kSecAttrAccount: profileID.uuidString,
            kSecAttrSynchronizable: kCFBooleanFalse as Any
        ]
    }
}

private struct ControllerTokenStoreError: LocalizedError {
    let operation: String
    let status: OSStatus

    var errorDescription: String? {
        "The macOS Keychain could not \(operation) the controller token (status \(status))."
    }
}

//
//  DeviceIDManager.swift
//  Saturn
//
//  Device ID management using iOS Keychain for persistent storage
//

import Foundation
import Security

/// Manages device identification using iOS Keychain for persistence across app reinstalls
final class DeviceIDManager {

    // MARK: - Singleton

    static let shared = DeviceIDManager()

    // MARK: - Constants

    private let keychainService = "com.cosmo.saturn.deviceid"
    private let keychainAccount = "deviceIdentifier"

    // MARK: - Private Init

    private init() {}

    // MARK: - Public Methods

    /// Retrieves or generates a device ID
    /// - Returns: The device ID string (UUID format)
    func getDeviceID() -> String {
        // Try to retrieve from Keychain first
        if let existingID = retrieveFromKeychain() {
            return existingID
        }

        // Generate new UUID if none exists
        let newID = UUID().uuidString
        saveToKeychain(newID)
        return newID
    }

    /// Clears the stored device ID (useful for testing/debugging)
    func clearDeviceID() {
        deleteFromKeychain()
    }

    // MARK: - Keychain Operations

    private func retrieveFromKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess,
              let data = item as? Data,
              let deviceID = String(data: data, encoding: .utf8) else {
            return nil
        }

        return deviceID
    }

    private func saveToKeychain(_ deviceID: String) {
        guard let data = deviceID.data(using: .utf8) else {
            return
        }

        // Delete existing item first (in case it exists)
        deleteFromKeychain()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        if status != errSecSuccess {
            print("DeviceIDManager: Failed to save device ID to Keychain. Status: \(status)")
        }
    }

    private func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount
        ]

        SecItemDelete(query as CFDictionary)
    }
}

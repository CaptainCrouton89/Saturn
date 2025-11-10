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
    private let keychainAccessGroup = "com.cosmo.saturn"

    // MARK: - Private Init

    private init() {}

    // MARK: - Public Methods

    /// Retrieves or generates a device ID
    /// - Returns: The device ID string (UUID format)
    func getDeviceID() -> String {
        print("\n🆔 DeviceIDManager: Getting device ID...")

        // Try to retrieve from Keychain first
        if let existingID = retrieveFromKeychain() {
            print("✅ DeviceIDManager: Using existing device ID: \(existingID)\n")
            return existingID
        }

        // Generate new UUID if none exists
        let newID = UUID().uuidString
        print("🆕 DeviceIDManager: Generated new device ID: \(newID)")
        saveToKeychain(newID)
        print("✅ DeviceIDManager: Returning new device ID\n")
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
            kSecAttrAccessGroup as String: keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        print("🔍 DeviceIDManager: Keychain retrieval status: \(status)")

        if status != errSecSuccess {
            let errorMessage = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown error"
            print("❌ DeviceIDManager: Keychain retrieval failed with status \(status): \(errorMessage)")
            print("   - Service: \(keychainService)")
            print("   - Account: \(keychainAccount)")
            print("   - Access Group: \(keychainAccessGroup)")

            if status == errSecItemNotFound {
                print("   → Device ID not found in Keychain (first launch or cleared)")
            }
            return nil
        }

        guard let data = item as? Data,
              let deviceID = String(data: data, encoding: .utf8) else {
            print("❌ DeviceIDManager: Failed to decode device ID from Keychain data")
            return nil
        }

        print("✅ DeviceIDManager: Successfully retrieved device ID from Keychain: \(deviceID)")
        return deviceID
    }

    private func saveToKeychain(_ deviceID: String) {
        guard let data = deviceID.data(using: .utf8) else {
            print("❌ DeviceIDManager: Failed to encode device ID as UTF-8 data")
            return
        }

        print("💾 DeviceIDManager: Attempting to save device ID to Keychain: \(deviceID)")

        // Delete existing item first (in case it exists)
        deleteFromKeychain()

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        if status != errSecSuccess {
            let errorMessage = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown error"
            print("❌ DeviceIDManager: Failed to save device ID to Keychain")
            print("   - Status: \(status)")
            print("   - Error: \(errorMessage)")
            print("   - Service: \(keychainService)")
            print("   - Account: \(keychainAccount)")
            print("   - Access Group: \(keychainAccessGroup)")
        } else {
            print("✅ DeviceIDManager: Successfully saved device ID to Keychain")
        }
    }

    private func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup
        ]

        let status = SecItemDelete(query as CFDictionary)

        if status == errSecSuccess {
            print("🗑️ DeviceIDManager: Deleted existing device ID from Keychain")
        } else if status == errSecItemNotFound {
            print("ℹ️ DeviceIDManager: No existing device ID to delete")
        } else {
            let errorMessage = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown error"
            print("⚠️ DeviceIDManager: Failed to delete device ID (status: \(status), error: \(errorMessage))")
        }
    }
}

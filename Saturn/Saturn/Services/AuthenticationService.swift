//
//  AuthenticationService.swift
//  Saturn
//
//  Handles user authentication with backend using device ID
//

import Foundation

struct AuthResponse: Codable {
    let success: Bool
    let data: AuthData
}

struct AuthData: Codable {
    let userId: String
    let accessToken: String
    let refreshToken: String
    let isNewUser: Bool
}

struct UserResponse: Codable {
    let success: Bool
    let data: UserData
}

struct UserData: Codable {
    let user: User
}

struct User: Codable {
    let id: String
    let deviceId: String
    let onboardingCompleted: Bool
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case deviceId = "device_id"
        case onboardingCompleted = "onboarding_completed"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

/// Manages user authentication and token storage
final class AuthenticationService {

    // MARK: - Singleton

    static let shared = AuthenticationService()

    // MARK: - Constants

    private let baseURL: String
    private let keychainService = "com.cosmo.saturn.auth"
    private let keychainAccessTokenAccount = "accessToken"
    private let keychainRefreshTokenAccount = "refreshToken"
    private let keychainUserIDAccount = "userId"

    // MARK: - Private Properties

    private var currentAccessToken: String?
    private var currentRefreshToken: String?
    private var currentUserID: String?

    // MARK: - Initialization

    private init() {
        self.baseURL = AuthenticationService.resolveBaseURL()

        // Load saved tokens and user ID from Keychain on init
        self.currentAccessToken = retrieveFromKeychain(account: keychainAccessTokenAccount)
        self.currentRefreshToken = retrieveFromKeychain(account: keychainRefreshTokenAccount)
        self.currentUserID = retrieveFromKeychain(account: keychainUserIDAccount)
    }

    // MARK: - Public Methods

    /// Register or authenticate the device with the backend
    /// Automatically called on app launch
    func authenticateDevice() async throws {
        let deviceID = DeviceIDManager.shared.getDeviceID()

        if let refreshToken = currentRefreshToken, !refreshToken.isEmpty {
            do {
                try await refreshAccessToken()
                return
            } catch {
                print("Saturn Auth: Refresh failed, attempting re-registration - \(error.localizedDescription)")
                logout()
            }
        }

        try await registerDevice(deviceID: deviceID)
    }

    private func registerDevice(deviceID: String) async throws {
        let url = URL(string: "\(baseURL)/api/auth/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["deviceId": deviceID]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.invalidResponse
        }

        guard httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
            throw AuthError.serverError(statusCode: httpResponse.statusCode)
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)

        persistSession(accessToken: authResponse.data.accessToken,
                       refreshToken: authResponse.data.refreshToken,
                       userId: authResponse.data.userId)

        print("Saturn Auth: Device authenticated - userId: \(authResponse.data.userId), isNewUser: \(authResponse.data.isNewUser)")
    }

    /// Get the current access token
    func getAccessToken() -> String? {
        return currentAccessToken
    }

    /// Get the current refresh token
    func getRefreshToken() -> String? {
        return currentRefreshToken
    }

    /// Get the current user ID
    func getUserID() -> String? {
        return currentUserID
    }

    /// Check if user is authenticated
    func isAuthenticated() -> Bool {
        return currentAccessToken != nil && currentRefreshToken != nil && currentUserID != nil
    }

    /// Get user profile from backend
    func getUserProfile() async throws -> User {
        guard let accessToken = currentAccessToken else {
            throw AuthError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/api/auth/me")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.serverError(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        let userResponse = try JSONDecoder().decode(UserResponse.self, from: data)
        return userResponse.data.user
    }

    /// Complete user onboarding
    func completeOnboarding() async throws {
        guard let accessToken = currentAccessToken else {
            throw AuthError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/api/auth/onboarding/complete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.serverError(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }

    /// Refresh access token using refresh token
    func refreshAccessToken() async throws {
        guard let refreshToken = currentRefreshToken else {
            throw AuthError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/api/auth/refresh")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["refreshToken": refreshToken]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.serverError(statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        struct RefreshResponse: Codable {
            let success: Bool
            let data: RefreshData
        }

        struct RefreshData: Codable {
            let accessToken: String
            let refreshToken: String
        }

        let refreshResponse = try JSONDecoder().decode(RefreshResponse.self, from: data)

        // Save new tokens to Keychain
        let userId = currentUserID
        persistSession(accessToken: refreshResponse.data.accessToken,
                       refreshToken: refreshResponse.data.refreshToken,
                       userId: userId)
    }

    /// Logout (clears tokens and user ID)
    func logout() {
        deleteFromKeychain(account: keychainAccessTokenAccount)
        deleteFromKeychain(account: keychainRefreshTokenAccount)
        deleteFromKeychain(account: keychainUserIDAccount)
        currentAccessToken = nil
        currentRefreshToken = nil
        currentUserID = nil
    }

    // MARK: - Keychain Operations

    private func retrieveFromKeychain(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }

        return value
    }

    private func saveToKeychain(_ value: String, account: String) {
        guard let data = value.data(using: .utf8) else {
            return
        }

        // Delete existing item first
        deleteFromKeychain(account: account)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        let status = SecItemAdd(query as CFDictionary, nil)

        if status != errSecSuccess {
            print("AuthenticationService: Failed to save to Keychain. Account: \(account), Status: \(status)")
        }
    }

    private func deleteFromKeychain(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]

        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Helpers

    private static func resolveBaseURL() -> String {
        if let envURL = ProcessInfo.processInfo.environment["API_BASE_URL"], !envURL.isEmpty {
            return envURL
        }

        if let bundleURL = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
           !bundleURL.isEmpty {
            return bundleURL
        }

        #if DEBUG
        print("Saturn Auth: API_BASE_URL missing, defaulting to http://localhost:3001")
        return "http://localhost:3001"
        #else
        fatalError("API_BASE_URL not configured for Saturn application.")
        #endif
    }

    private func persistSession(accessToken: String?, refreshToken: String?, userId: String?) {
        if let accessToken {
            saveToKeychain(accessToken, account: keychainAccessTokenAccount)
            self.currentAccessToken = accessToken
        }

        if let refreshToken {
            saveToKeychain(refreshToken, account: keychainRefreshTokenAccount)
            self.currentRefreshToken = refreshToken
        }

        if let userId {
            saveToKeychain(userId, account: keychainUserIDAccount)
            self.currentUserID = userId
        }
    }
}

// MARK: - Error Types

enum AuthError: Error, LocalizedError {
    case invalidResponse
    case serverError(statusCode: Int)
    case notAuthenticated
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let statusCode):
            return "Server error: \(statusCode)"
        case .notAuthenticated:
            return "User is not authenticated"
        case .decodingError:
            return "Failed to decode server response"
        }
    }
}

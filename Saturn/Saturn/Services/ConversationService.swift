//
//  ConversationService.swift
//  Saturn
//
//  Handles conversation API calls to backend
//

import Foundation

// MARK: - API Response Models

struct ConversationsResponse: Codable {
    let success: Bool
    let data: ConversationsData
}

struct ConversationsData: Codable {
    let conversations: [ConversationSummaryResponse]
    let total: Int
    let hasMore: Bool
}

struct ConversationSummaryResponse: Codable {
    let id: String
    let summary: String?
    let status: String
    let createdAt: String
    let endedAt: String?
    let triggerMethod: String?
}

struct ConversationCreateResponse: Codable {
    let success: Bool
    let data: ResponseData

    struct ResponseData: Codable {
        let conversation: ConversationData
    }

    struct ConversationData: Codable {
        let id: String
        let userId: String
        let status: String
        let createdAt: String
        let triggerMethod: String
    }
}

struct ExchangeRequest: Codable {
    let userMessage: String
    let turnNumber: Int
}

struct ConversationExchangeResponse: Codable {
    let success: Bool
    let data: ExchangeData

    struct ExchangeData: Codable {
        let response: ExchangeResponseData
        let conversationHistory: [ConversationTurn]
    }

    struct ExchangeResponseData: Codable {
        let text: String
        let audioUrl: String?
        let turnNumber: Int
        let timestamp: String
    }
}

struct ConversationTurn: Codable {
    let speaker: String  // "user" | "assistant"
    let text: String
    let timestamp: String
    let audioSegmentId: String?
}

// MARK: - Service

/// Manages conversation API calls
final class ConversationService {

    // MARK: - Singleton

    static let shared = ConversationService()

    // MARK: - Constants

    private let baseURL: String

    // MARK: - Initialization

    private init() {
        self.baseURL = ConversationService.resolveBaseURL()
    }

    // MARK: - Public Methods

    /// Fetch conversations for the authenticated user
    /// - Parameters:
    ///   - limit: Maximum number of conversations to fetch (default: 50)
    ///   - offset: Number of conversations to skip for pagination (default: 0)
    ///   - status: Optional status filter ("active", "completed", etc.)
    /// - Returns: Array of ConversationSummary objects
    func fetchConversations(
        limit: Int = 50,
        offset: Int = 0,
        status: String? = nil
    ) async throws -> [ConversationSummary] {
        guard let accessToken = AuthenticationService.shared.getAccessToken() else {
            throw ConversationError.notAuthenticated
        }

        // Build URL with query parameters
        var components = URLComponents(string: "\(baseURL)/api/conversations")!
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]

        if let status = status {
            queryItems.append(URLQueryItem(name: "status", value: status))
        }

        components.queryItems = queryItems

        guard let url = components.url else {
            throw ConversationError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConversationError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            throw ConversationError.serverError(statusCode: httpResponse.statusCode)
        }

        let conversationsResponse = try JSONDecoder().decode(ConversationsResponse.self, from: data)

        // Convert API response to app models
        let conversations = conversationsResponse.data.conversations.compactMap { apiConversation -> ConversationSummary? in
            // Parse ISO 8601 date string
            guard let date = ISO8601DateFormatter().date(from: apiConversation.createdAt) else {
                print("ConversationService: Failed to parse date for conversation \(apiConversation.id)")
                return nil
            }

            // Parse UUID from string
            guard let uuid = UUID(uuidString: apiConversation.id) else {
                print("ConversationService: Invalid UUID for conversation \(apiConversation.id)")
                return nil
            }

            return ConversationSummary(
                id: uuid,
                summary: apiConversation.summary ?? "No summary available",
                date: date
            )
        }

        return conversations
    }

    /// Create a new conversation
    /// - Parameter triggerMethod: How the conversation was triggered (default: "manual")
    /// - Returns: ConversationCreateResponse with conversation ID and metadata
    func createConversation(triggerMethod: String = "manual") async throws -> ConversationCreateResponse {
        guard let accessToken = AuthenticationService.shared.getAccessToken() else {
            throw ConversationError.notAuthenticated
        }

        guard let url = URL(string: "\(baseURL)/api/conversations") else {
            throw ConversationError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["triggerMethod": triggerMethod]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConversationError.invalidResponse
        }

        guard httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
            throw ConversationError.serverError(statusCode: httpResponse.statusCode)
        }

        let createResponse = try JSONDecoder().decode(ConversationCreateResponse.self, from: data)
        return createResponse
    }

    /// Send user message and get Cosmo's response
    /// - Parameters:
    ///   - conversationId: The ID of the active conversation
    ///   - userMessage: The user's transcribed message
    ///   - turnNumber: Sequential turn number in the conversation
    /// - Returns: ConversationExchangeResponse with Cosmo's response and updated history
    func sendExchange(
        conversationId: String,
        userMessage: String,
        turnNumber: Int
    ) async throws -> ConversationExchangeResponse {
        guard let accessToken = AuthenticationService.shared.getAccessToken() else {
            throw ConversationError.notAuthenticated
        }

        guard let url = URL(string: "\(baseURL)/api/conversations/\(conversationId)/exchange") else {
            throw ConversationError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ExchangeRequest(userMessage: userMessage, turnNumber: turnNumber)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ConversationError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            throw ConversationError.serverError(statusCode: httpResponse.statusCode)
        }

        let exchangeResponse = try JSONDecoder().decode(ConversationExchangeResponse.self, from: data)
        return exchangeResponse
    }

    /// End a conversation
    /// - Parameter conversationId: The ID of the conversation to end
    /// - Throws: ConversationError if the request fails
    func endConversation(conversationId: String) async throws {
        print("🔄 ConversationService: Starting endConversation for ID: \(conversationId)")

        guard let accessToken = AuthenticationService.shared.getAccessToken() else {
            print("❌ ConversationService: No access token available")
            throw ConversationError.notAuthenticated
        }

        guard let url = URL(string: "\(baseURL)/api/conversations/\(conversationId)/end") else {
            print("❌ ConversationService: Invalid URL: \(baseURL)/api/conversations/\(conversationId)/end")
            throw ConversationError.invalidURL
        }

        print("📤 ConversationService: Sending POST to \(url.absoluteString)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("❌ ConversationService: Invalid response type")
            throw ConversationError.invalidResponse
        }

        print("📥 ConversationService: Received response with status code: \(httpResponse.statusCode)")

        guard httpResponse.statusCode == 200 else {
            // Log response body for debugging
            if let responseBody = String(data: data, encoding: .utf8) {
                print("❌ ConversationService: Error response body: \(responseBody)")
            }
            print("❌ ConversationService: Server returned status code: \(httpResponse.statusCode)")
            throw ConversationError.serverError(statusCode: httpResponse.statusCode)
        }

        print("✅ ConversationService: Successfully ended conversation")
    }

    // MARK: - Helpers

    private static func resolveBaseURL() -> String {
        guard let baseURL = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String, !baseURL.isEmpty else {
            fatalError("API_BASE_URL not found in Info.plist")
        }
        return baseURL
    }
}

// MARK: - Error Types

enum ConversationError: Error, LocalizedError {
    case notAuthenticated
    case invalidURL
    case invalidResponse
    case serverError(statusCode: Int)
    case decodingError

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let statusCode):
            return "Server error: \(statusCode)"
        case .decodingError:
            return "Failed to decode server response"
        }
    }
}

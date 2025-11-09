//
//  AssemblyAIService.swift
//  Saturn
//
//  Real-time speech-to-text streaming via AssemblyAI WebSocket API
//

import Foundation
import AVFoundation

/// Real-time streaming service for AssemblyAI STT
actor AssemblyAIService {
    private let apiKey: String
    private let sessionDelegate: AssemblyAIWebSocketDelegate
    private let urlSession: URLSession
    private var webSocketTask: URLSessionWebSocketTask?
    private var isStreaming = false
    private var isConnected = false  // Track connection state
    private var connectionContinuation: CheckedContinuation<Void, Error>?

    // Callbacks
    private var onPartialTranscript: ((String) -> Void)?
    private var onFinalTranscript: ((String) -> Void)?
    private var onError: ((Error) -> Void)?

    init() {
        self.apiKey = AssemblyAIService.resolveAPIKey()

        let delegate = AssemblyAIWebSocketDelegate()
        self.sessionDelegate = delegate
        self.urlSession = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
    }

    /// Start streaming audio to AssemblyAI
    func startStreaming(
        onPartial: @escaping (String) -> Void,
        onFinal: @escaping (String) -> Void,
        onError: @escaping (Error) -> Void
    ) async throws {
        guard !isStreaming else { return }

        print("🎤 AssemblyAI: Starting connection with API key: \(apiKey.prefix(10))...")

        self.onPartialTranscript = onPartial
        self.onFinalTranscript = onFinal
        self.onError = onError

        let token = try await fetchRealtimeToken()

        // Create WebSocket connection to AssemblyAI realtime endpoint (token required in query)
        guard let encodedToken = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000&token=\(encodedToken)") else {
            throw STTError.connectionFailed
        }

        var request = URLRequest(url: url)
        request.setValue("assemblyai-ws+json", forHTTPHeaderField: "Sec-WebSocket-Protocol")

        webSocketTask = urlSession.webSocketTask(with: request)
        webSocketTask?.resume()

        isStreaming = true

        // Start receiving messages
        receiveMessage()

        // Wait for SessionBegins message (with timeout)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.connectionContinuation = continuation

            // Timeout after 5 seconds
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if !self.isConnected {
                    self.connectionContinuation?.resume(throwing: STTError.connectionFailed)
                    self.connectionContinuation = nil
                }
            }
        }

        print("✅ AssemblyAI: Connection established")
    }

    /// Send audio chunk to AssemblyAI
    func sendAudioChunk(_ audioData: Data) async throws {
        guard isStreaming, let webSocketTask = webSocketTask else {
            throw STTError.notStreaming
        }

        // Don't send if not connected yet
        guard isConnected else {
            return // Silently skip until connected
        }

        // Convert to base64 as required by AssemblyAI
        let base64Audio = audioData.base64EncodedString()
        let message: [String: Any] = ["audio_data": base64Audio]

        let jsonData = try JSONSerialization.data(withJSONObject: message)
        guard let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw STTError.invalidResponse
        }

        try await webSocketTask.send(.string(jsonString))
    }

    /// Stop streaming and close connection
    func stopStreaming() async {
        guard isStreaming else { return }

        // Send termination message
        let terminate: [String: Any] = ["terminate_session": true]
        if let jsonData = try? JSONSerialization.data(withJSONObject: terminate),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            try? await webSocketTask?.send(.string(jsonString))
        }

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        isStreaming = false
        isConnected = false
    }

    // MARK: - Private Methods

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            Task {
                await self?.handleMessage(result)
            }
        }
    }

    private func fetchRealtimeToken() async throws -> String {
        guard let url = URL(string: "https://api.assemblyai.com/v2/realtime/token") else {
            throw STTError.connectionFailed
        }

        print("🔐 AssemblyAI: Fetching realtime token")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["expires_in": 3600]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw STTError.connectionFailed
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            throw STTError.tokenFetchFailed(status: httpResponse.statusCode, message: errorBody)
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String else {
            throw STTError.invalidResponse
        }

        return token
    }

    private func handleMessage(_ result: Result<URLSessionWebSocketTask.Message, Error>) async {
        switch result {
        case .success(let message):
            switch message {
            case .string(let text):
                handleTranscriptMessage(text)
            case .data:
                break
            @unknown default:
                break
            }

            // Continue receiving if still streaming
            if isStreaming {
                receiveMessage()
            }

        case .failure(let error):
            onError?(error)
            await stopStreaming()
        }
    }

    private func handleTranscriptMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            print("⚠️ AssemblyAI: Failed to parse message")
            return
        }

        // Parse transcript events from AssemblyAI
        // Events: SessionBegins, PartialTranscript, FinalTranscript, SessionTerminated, Error
        if let messageType = json["message_type"] as? String {
            print("📨 AssemblyAI: Received \(messageType)")

            switch messageType {
            case "SessionBegins":
                print("✅ AssemblyAI: Session started")
                isConnected = true
                connectionContinuation?.resume()
                connectionContinuation = nil

            case "PartialTranscript":
                if let transcript = json["text"] as? String, !transcript.isEmpty {
                    print("📝 Partial: \(transcript)")
                    onPartialTranscript?(transcript)
                }

            case "FinalTranscript":
                if let transcript = json["text"] as? String, !transcript.isEmpty {
                    print("✅ Final: \(transcript)")
                    onFinalTranscript?(transcript)
                }

            case "SessionTerminated":
                print("🔚 AssemblyAI: Session terminated")

            default:
                print("ℹ️ AssemblyAI: Unknown message type: \(messageType)")
            }
        }
    }

    private static func resolveAPIKey() -> String {
        // Allow CI/local overrides without touching Info.plist
        if let envKey = ProcessInfo.processInfo.environment["ASSEMBLYAI_API_KEY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !envKey.isEmpty {
            return envKey
        }

        if let plistKey = Bundle.main.object(forInfoDictionaryKey: "ASSEMBLYAI_API_KEY") as? String {
            let trimmed = plistKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, trimmed != "$(ASSEMBLYAI_API_KEY)" {
                return trimmed
            }
        }

        fatalError("ASSEMBLYAI_API_KEY not configured. Set it in Info.plist or export ASSEMBLYAI_API_KEY before launching Saturn.")
    }
}

// MARK: - Error Types

enum STTError: Error, LocalizedError {
    case notStreaming
    case connectionFailed
    case invalidResponse
    case tokenFetchFailed(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .notStreaming:
            return "STT service is not streaming"
        case .connectionFailed:
            return "Failed to connect to STT service"
        case .invalidResponse:
            return "Invalid response from STT service"
        case .tokenFetchFailed(let status, let message):
            return "Failed to obtain STT token (status: \(status))\(message.isEmpty ? "" : ": \(message)")"
        }
    }
}

// MARK: - URLSession Delegate

final class AssemblyAIWebSocketDelegate: NSObject, URLSessionWebSocketDelegate, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("📡 AssemblyAI: WebSocket opened (protocol=\(`protocol` ?? "none"))")
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) } ?? "none"
        print("📡 AssemblyAI: WebSocket closed (code=\(closeCode.rawValue), reason=\(reasonString))")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            print("📡 AssemblyAI: WebSocket task completed with error: \(error.localizedDescription)")
        }
    }
}

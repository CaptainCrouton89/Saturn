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

    /// Start streaming audio to AssemblyAI (v3 API)
    func startStreaming(
        onPartial: @escaping (String) -> Void,
        onFinal: @escaping (String) -> Void,
        onError: @escaping (Error) -> Void
    ) async throws {
        guard !isStreaming else { return }

        print("🎤 AssemblyAI: Starting v3 connection with API key: \(apiKey.prefix(10))...")

        self.onPartialTranscript = onPartial
        self.onFinalTranscript = onFinal
        self.onError = onError

        // v3 API - Connect to streaming endpoint with config in URL params
        guard let url = URL(string: "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true") else {
            throw STTError.connectionFailed
        }

        var request = URLRequest(url: url)
        // v3 API expects the API key in the Authorization header
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")

        webSocketTask = urlSession.webSocketTask(with: request)
        webSocketTask?.resume()

        isStreaming = true

        // Start receiving messages
        receiveMessage()

        // Wait for Begin event (with timeout)
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

        print("✅ AssemblyAI: v3 Connection established")
    }

    /// Send audio chunk to AssemblyAI (v3 API)
    func sendAudioChunk(_ audioData: Data) async throws {
        guard isStreaming, let webSocketTask = webSocketTask else {
            throw STTError.notStreaming
        }

        // Don't send if not connected yet
        guard isConnected else {
            return // Silently skip until connected
        }

        // v3 API: Send raw audio bytes (PCM16 format)
        // Parameters are sent in URL query string during connection
        try await webSocketTask.send(.data(audioData))
    }

    /// Stop streaming and close connection (v3 API)
    func stopStreaming() async {
        guard isStreaming else { return }

        // v3 API: Send termination message with `terminate: true`
        let terminate: [String: Bool] = ["terminate": true]
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

        // v3 API events: Begin, Turn, Termination, Error
        if let rawEventType = (json["event"] as? String) ?? (json["type"] as? String) {
            let eventType = rawEventType.lowercased()
            print("📨 AssemblyAI v3: Received \(rawEventType)")

            switch eventType {
            case "begin":
                // Session started - extract session ID
                if let sessionId = json["id"] as? String {
                    print("✅ AssemblyAI v3: Session started (\(sessionId))")
                }
                isConnected = true
                connectionContinuation?.resume()
                connectionContinuation = nil

            case "turn":
                // Turn event contains transcript and end_of_turn flag
                if let transcript = json["transcript"] as? String, !transcript.isEmpty {
                    let endOfTurn = json["end_of_turn"] as? Bool ?? false
                    let turnIsFormatted = json["turn_is_formatted"] as? Bool ?? false

                    if endOfTurn {
                        print("✅ Final (formatted=\(turnIsFormatted)): \(transcript)")
                        onFinalTranscript?(transcript)
                    } else {
                        print("📝 Partial: \(transcript)")
                        onPartialTranscript?(transcript)
                    }
                }

            case "termination":
                // Session ended - extract audio duration if available
                if let audioDuration = json["audio_duration_seconds"] as? Double {
                    print("🔚 AssemblyAI v3: Session terminated (\(audioDuration)s processed)")
                } else {
                    print("🔚 AssemblyAI v3: Session terminated")
                }

            case "error":
                // Error event
                if let errorMessage = json["error"] as? String {
                    print("❌ AssemblyAI v3: Error - \(errorMessage)")
                    onError?(STTError.serverError(errorMessage))
                }

            default:
                print("ℹ️ AssemblyAI v3: Unknown event type: \(eventType)")
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
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .notStreaming:
            return "STT service is not streaming"
        case .connectionFailed:
            return "Failed to connect to STT service"
        case .invalidResponse:
            return "Invalid response from STT service"
        case .serverError(let message):
            return "STT server error: \(message)"
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

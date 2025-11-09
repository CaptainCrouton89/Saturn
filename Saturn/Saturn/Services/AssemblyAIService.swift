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
    private var webSocketTask: URLSessionWebSocketTask?
    private var isStreaming = false

    // Callbacks
    private var onPartialTranscript: ((String) -> Void)?
    private var onFinalTranscript: ((String) -> Void)?
    private var onError: ((Error) -> Void)?

    init() {
        self.apiKey = AssemblyAIService.resolveAPIKey()
    }

    /// Start streaming audio to AssemblyAI
    func startStreaming(
        onPartial: @escaping (String) -> Void,
        onFinal: @escaping (String) -> Void,
        onError: @escaping (Error) -> Void
    ) async throws {
        guard !isStreaming else { return }

        self.onPartialTranscript = onPartial
        self.onFinalTranscript = onFinal
        self.onError = onError

        // Create WebSocket connection to AssemblyAI realtime endpoint
        guard let url = URL(string: "wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000") else {
            throw STTError.connectionFailed
        }

        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "Authorization")

        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()

        isStreaming = true

        // Start receiving messages
        receiveMessage()
    }

    /// Send audio chunk to AssemblyAI
    func sendAudioChunk(_ audioData: Data) async throws {
        guard isStreaming, let webSocketTask = webSocketTask else {
            throw STTError.notStreaming
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
            return
        }

        // Parse transcript events from AssemblyAI
        // Events: Begin, PartialTranscript, FinalTranscript, Termination, Error
        if let messageType = json["message_type"] as? String {
            switch messageType {
            case "PartialTranscript":
                if let transcript = json["text"] as? String, !transcript.isEmpty {
                    onPartialTranscript?(transcript)
                }
            case "FinalTranscript":
                if let transcript = json["text"] as? String, !transcript.isEmpty {
                    onFinalTranscript?(transcript)
                }
            case "SessionBegins":
                print("AssemblyAI: Session started")
            case "SessionTerminated":
                print("AssemblyAI: Session terminated")
            default:
                break
            }
        }
    }

    private static func resolveAPIKey() -> String {
        guard let apiKey = Bundle.main.object(forInfoDictionaryKey: "ASSEMBLYAI_API_KEY") as? String, !apiKey.isEmpty else {
            fatalError("ASSEMBLYAI_API_KEY not found in Info.plist")
        }
        return apiKey
    }
}

// MARK: - Error Types

enum STTError: Error, LocalizedError {
    case notStreaming
    case connectionFailed
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notStreaming:
            return "STT service is not streaming"
        case .connectionFailed:
            return "Failed to connect to STT service"
        case .invalidResponse:
            return "Invalid response from STT service"
        }
    }
}

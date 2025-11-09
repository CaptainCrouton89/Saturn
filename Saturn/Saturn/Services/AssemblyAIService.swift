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
    private var terminationCleanupTask: Task<Void, Never>?

    // Accumulate all formatted transcripts during recording session
    private var accumulatedFormattedTranscripts: [String] = []
    private var currentPartialTranscript = ""

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

        // Reset transcripts for new recording session
        self.accumulatedFormattedTranscripts = []
        self.currentPartialTranscript = ""

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
        if let webSocketTask {
            receiveMessage(from: webSocketTask)
        }

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

        // Mark as stopped FIRST to prevent error handler from showing errors
        isStreaming = false
        isConnected = false

        // Combine all accumulated formatted transcripts from this session
        let finalTranscript: String
        if !accumulatedFormattedTranscripts.isEmpty {
            // Join all formatted sentences with space separator
            finalTranscript = accumulatedFormattedTranscripts.joined(separator: " ")
            print("🛑 Manual stop - sending \(accumulatedFormattedTranscripts.count) sentence(s): \(finalTranscript)")
        } else if !currentPartialTranscript.isEmpty {
            // Edge case: user stopped before getting any formatted finals
            finalTranscript = currentPartialTranscript
            print("🛑 Manual stop - using partial (no formatted received): \(finalTranscript)")
        } else {
            // No speech detected
            finalTranscript = ""
            print("🛑 Manual stop - no speech detected")
        }

        // Trigger callback to send to agent
        onFinalTranscript?(finalTranscript)
        accumulatedFormattedTranscripts.removeAll()
        currentPartialTranscript = ""

        // v3 API: Send termination message with `terminate: true`
        let taskToClose = webSocketTask
        let terminate: [String: Bool] = ["terminate_session": true]
        if let jsonData = try? JSONSerialization.data(withJSONObject: terminate),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            try? await webSocketTask?.send(.string(jsonString))
        }

        if let taskToClose {
            scheduleTerminationCleanup(for: taskToClose)
        }
        webSocketTask = nil
    }

    // MARK: - Private Methods

    private func receiveMessage(from task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task {
                await self?.handleMessage(result, from: task)
            }
        }
    }

    private func handleMessage(_ result: Result<URLSessionWebSocketTask.Message, Error>, from task: URLSessionWebSocketTask) async {
        switch result {
        case .success(let message):
            switch message {
            case .string(let text):
                await handleTranscriptMessage(text, from: task)
            case .data:
                break
            @unknown default:
                break
            }

            // Continue receiving if still streaming
            if isStreaming, task === webSocketTask {
                receiveMessage(from: task)
            }

        case .failure(let error):
            // Only report errors if we're still supposed to be streaming
            // When stopStreaming() is called, isStreaming=false, so ignore expected close errors
            if isStreaming {
                print("❌ WebSocket error during active stream: \(error.localizedDescription)")
                onError?(error)
                await stopStreaming()
            } else {
                print("ℹ️ WebSocket closed (expected): \(error.localizedDescription)")
            }
        }
    }

    private func handleTranscriptMessage(_ text: String, from task: URLSessionWebSocketTask) async {
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

                    if endOfTurn && turnIsFormatted {
                        // ACCUMULATE formatted finals (don't replace - add to array!)
                        // Multiple sentences during one recording session need to be preserved
                        print("✅ Formatted final received: \(transcript)")
                        accumulatedFormattedTranscripts.append(transcript)
                        currentPartialTranscript = ""  // Clear partial since we got the formatted version
                    } else if !endOfTurn {
                        // Show partial transcripts live during recording (current sentence only)
                        print("📝 Partial: \(transcript)")
                        currentPartialTranscript = transcript
                        onPartialTranscript?(transcript)
                    } else {
                        // Ignore unformatted finals (formatted=false)
                        print("⏭️ Skipping unformatted final: \(transcript)")
                    }
                }

            case "termination":
                // Session ended - extract audio duration if available
                if let audioDuration = json["audio_duration_seconds"] as? Double {
                    print("🔚 AssemblyAI v3: Session terminated (\(audioDuration)s processed)")
                } else {
                    print("🔚 AssemblyAI v3: Session terminated")
                }
                await closeWebSocket(task)

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

    private func scheduleTerminationCleanup(for task: URLSessionWebSocketTask) {
        terminationCleanupTask?.cancel()
        terminationCleanupTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await self?.closeWebSocket(task)
        }
    }

    private func closeWebSocket(_ task: URLSessionWebSocketTask?) async {
        terminationCleanupTask?.cancel()
        terminationCleanupTask = nil
        guard let task else { return }
        task.cancel(with: .normalClosure, reason: nil)
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

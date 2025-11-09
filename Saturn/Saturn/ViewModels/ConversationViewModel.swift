import Foundation
import Combine
import SwiftUI

@MainActor
class ConversationViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var micState: MicState = .idle
    @Published var currentTranscript: String = ""  // Live partial transcript
    @Published var isWaitingForResponse: Bool = false
    @Published var errorMessage: String?  // For displaying alerts

    enum MicState {
        case idle        // Ready to record
        case recording   // User is speaking
        case processing  // Waiting for Cosmo response
    }

    // Real services (replace mock)
    private let conversationService = ConversationService.shared
    private let sttService = AssemblyAIService()
    private let audioService = AudioRecordingService()

    // Conversation state
    private var conversationId: String?
    private var turnNumber: Int = 0

    // MARK: - Public Methods

    /// Start conversation: Create conversation + Start STT + Start recording
    func startRecording() {
        micState = .recording
        currentTranscript = ""
        errorMessage = nil

        Task {
            do {
                // 1. Create conversation in background (don't wait)
                Task {
                    if conversationId == nil {
                        do {
                            let response = try await conversationService.createConversation()
                            self.conversationId = response.conversation.id
                            print("✅ Conversation created: \(response.conversation.id)")
                        } catch {
                            print("❌ Failed to create conversation: \(error)")
                            // Continue with STT anyway - we can retry conversation creation later
                        }
                    }
                }

                // 2. Start AssemblyAI streaming
                try await sttService.startStreaming(
                    onPartial: { [weak self] transcript in
                        Task { @MainActor in
                            self?.currentTranscript = transcript
                        }
                    },
                    onFinal: { [weak self] transcript in
                        Task { @MainActor in
                            await self?.handleFinalTranscript(transcript)
                        }
                    },
                    onError: { [weak self] error in
                        Task { @MainActor in
                            self?.handleError(error)
                        }
                    }
                )

                // 3. Start audio recording
                try await audioService.startRecording { [weak self] audioChunk in
                    Task {
                        try? await self?.sttService.sendAudioChunk(audioChunk)
                    }
                }

            } catch {
                handleError(error)
            }
        }
    }

    func stopRecording() {
        Task {
            // Stop audio recording
            await audioService.stopRecording()

            // Stop STT (will trigger final transcript)
            await sttService.stopStreaming()
        }
    }

    func resetConversation() {
        messages.removeAll()
        conversationId = nil
        turnNumber = 0
        micState = .idle
        currentTranscript = ""
        isWaitingForResponse = false
        errorMessage = nil
    }

    // MARK: - Private Methods

    private func handleFinalTranscript(_ transcript: String) async {
        guard !transcript.isEmpty else {
            // No speech detected - return to idle
            micState = .idle
            return
        }

        micState = .processing
        currentTranscript = ""

        // Add user message
        let userMessage = Message(role: .user, text: transcript)
        messages.append(userMessage)

        // Send to backend
        await sendToBackend(userMessage: transcript)
    }

    private func sendToBackend(userMessage: String) async {
        guard let conversationId = conversationId else {
            // Conversation creation failed - show error
            handleError(ConversationError.notAuthenticated)
            micState = .idle
            return
        }

        turnNumber += 1
        isWaitingForResponse = true

        do {
            let response = try await conversationService.sendExchange(
                conversationId: conversationId,
                userMessage: userMessage,
                turnNumber: turnNumber
            )

            // Add assistant message
            let assistantMessage = Message(role: .assistant, text: response.response.text)
            messages.append(assistantMessage)

            // Auto-reactivate mic for next turn
            micState = .idle
            isWaitingForResponse = false

        } catch {
            handleError(error)
            micState = .idle
            isWaitingForResponse = false
        }
    }

    private func handleError(_ error: Error) {
        print("❌ Error: \(error.localizedDescription)")
        errorMessage = error.localizedDescription
        micState = .idle
    }
}

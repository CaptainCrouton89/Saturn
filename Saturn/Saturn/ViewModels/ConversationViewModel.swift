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
    @Published private(set) var conversationId: String?
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
                            self.conversationId = response.data.conversation.id
                            print("✅ Conversation created: \(response.data.conversation.id)")
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

    func endConversation() {
        Task {
            // Ensure we flush any pending audio/STT before ending
            await audioService.stopRecording()
            await sttService.stopStreaming()

            // End the conversation on the backend if one exists
            if let conversationId = conversationId {
                do {
                    print("🔄 Attempting to end conversation: \(conversationId)")
                    try await conversationService.endConversation(conversationId: conversationId)
                    print("✅ Conversation ended successfully: \(conversationId)")
                } catch {
                    print("❌ FAILED to end conversation: \(conversationId)")
                    print("❌ Error type: \(type(of: error))")
                    print("❌ Error description: \(error.localizedDescription)")
                    if let conversationError = error as? ConversationError {
                        print("❌ ConversationError details: \(conversationError)")
                    }

                    // Show error to user so they know it failed
                    await MainActor.run {
                        self.errorMessage = "Failed to end conversation: \(error.localizedDescription)"
                    }

                    // Don't reset local state if ending failed - keep the conversation ID
                    // so user can try again
                    return
                }
            } else {
                print("⚠️ No conversation ID to end")
            }

            // Reset local state only if ending succeeded
            resetConversation()
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
            let assistantMessage = Message(role: .assistant, text: response.data.response.text)
            messages.append(assistantMessage)

            // Auto-restart recording for next turn (conversational flow)
            isWaitingForResponse = false
            startRecording()  // Automatically begin listening for user's next turn

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

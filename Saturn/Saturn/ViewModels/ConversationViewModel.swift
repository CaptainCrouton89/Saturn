import Foundation
import Combine

@MainActor
class ConversationViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var micState: MicState = .idle
    @Published var isWaitingForResponse: Bool = false

    enum MicState {
        case idle        // Ready to record
        case recording   // User is speaking
        case processing  // Waiting for Cosmo response
    }

    private let mockService = MockConversationService()

    // MARK: - Public Methods

    func startRecording() {
        micState = .recording
    }

    func stopRecording() {
        micState = .processing

        // Add mock user message
        let userMessage = Message(
            role: .user,
            text: generateMockUserMessage()
        )
        messages.append(userMessage)

        // Trigger mock response
        Task {
            await handleMockResponse()
        }
    }

    func sendMessage(_ text: String) {
        let userMessage = Message(role: .user, text: text)
        messages.append(userMessage)

        Task {
            await handleMockResponse()
        }
    }

    func resetConversation() {
        messages.removeAll()
        micState = .idle
        isWaitingForResponse = false
    }

    // MARK: - Private Methods

    private func handleMockResponse() async {
        isWaitingForResponse = true

        // Get mock response from service
        let responseText = await mockService.getResponse(for: messages.last?.text ?? "")

        // Add assistant message
        let assistantMessage = Message(role: .assistant, text: responseText)
        messages.append(assistantMessage)

        // Auto-reactivate mic
        micState = .idle
        isWaitingForResponse = false
    }

    private func generateMockUserMessage() -> String {
        let mockUserMessages = [
            "I've been feeling stressed about work lately",
            "The deadlines keep piling up",
            "I'm not sure what to prioritize",
            "Sometimes I feel overwhelmed by all the decisions",
            "I've been thinking about making a change",
            "It's hard to balance everything",
            "I wonder if I'm on the right path",
            "There's so much I want to accomplish",
            "I'm trying to figure out what matters most",
            "I need to find better ways to manage my time"
        ]

        return mockUserMessages.randomElement() ?? "Tell me more"
    }
}

import Foundation

actor MockConversationService {
    private let responses = [
        "That's interesting. Can you tell me more about that?",
        "How does that make you feel?",
        "What do you think led to that?",
        "I'm curious—what's the bigger picture here?",
        "That sounds challenging. What's been the hardest part?",
        "I see. What would you like to happen next?",
        "Tell me more about that.",
        "What's been on your mind about this?",
        "How long has this been something you've thought about?",
        "What matters most to you here?"
    ]

    private var currentIndex = 0

    func getResponse(for userMessage: String) async -> String {
        // Simulate network delay
        try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds

        // Cycle through responses
        let response = responses[currentIndex]
        currentIndex = (currentIndex + 1) % responses.count

        return response
    }
}

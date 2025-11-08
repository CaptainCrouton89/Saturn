import Foundation
import Combine

@MainActor
class ArchiveViewModel: ObservableObject {
    @Published var conversations: [ConversationSummary] = []

    init() {
        // Load mock conversations
        self.conversations = [
            ConversationSummary(
                id: UUID(),
                summary: "Talked about work stress and upcoming deadlines",
                date: Date()
            ),
            ConversationSummary(
                id: UUID(),
                summary: "Ideas for side project - AI voice app",
                date: Date().addingTimeInterval(-86400) // Yesterday
            ),
            ConversationSummary(
                id: UUID(),
                summary: "Relationship thoughts and communication",
                date: Date().addingTimeInterval(-172800) // 2 days ago
            ),
            ConversationSummary(
                id: UUID(),
                summary: "Career decisions and life direction",
                date: Date().addingTimeInterval(-259200) // 3 days ago
            )
        ]
    }
}

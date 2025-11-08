import Foundation

struct ConversationSummary: Identifiable, Equatable {
    let id: UUID
    let summary: String
    let date: Date
}

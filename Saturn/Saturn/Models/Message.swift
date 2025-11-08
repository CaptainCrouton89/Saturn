import Foundation

struct Message: Identifiable, Equatable {
    let id: UUID
    let role: Role
    let text: String
    let timestamp: Date

    enum Role {
        case user
        case assistant
    }

    init(id: UUID = UUID(), role: Role, text: String, timestamp: Date = Date()) {
        self.id = id
        self.role = role
        self.text = text
        self.timestamp = timestamp
    }
}

// MARK: - Sample Data for Previews
extension Message {
    static let sampleUser = Message(
        role: .user,
        text: "I've been feeling stressed about work lately"
    )

    static let sampleAssistant = Message(
        role: .assistant,
        text: "That sounds tough. What's been the hardest part?"
    )

    static let sampleConversation: [Message] = [
        .sampleUser,
        .sampleAssistant,
        Message(role: .user, text: "The deadlines keep piling up"),
        Message(role: .assistant, text: "How are you managing your time?"),
        Message(role: .user, text: "Not very well, to be honest"),
        Message(role: .assistant, text: "What would help you feel more in control?")
    ]
}

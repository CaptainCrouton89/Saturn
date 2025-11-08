import SwiftUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                // Assistant bubble (left-aligned)
                bubbleContent
                    .background(Color(.systemGray5))
                    .foregroundColor(.primary)
                Spacer()
            } else {
                // User bubble (right-aligned)
                Spacer()
                bubbleContent
                    .background(Color.blue)
                    .foregroundColor(.white)
            }
        }
    }

    private var bubbleContent: some View {
        Text(message.text)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

#Preview {
    VStack(spacing: 12) {
        MessageBubble(message: .sampleUser)
        MessageBubble(message: .sampleAssistant)
    }
    .padding()
}

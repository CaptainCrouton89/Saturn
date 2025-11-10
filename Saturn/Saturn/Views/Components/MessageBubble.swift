import SwiftUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                // Assistant bubble (left-aligned)
                bubbleContent
                    #if os(iOS)
                    .background(Color(.systemGray5))
                    #else
                    .background(Color(nsColor: .controlBackgroundColor))
                    #endif
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

#if DEBUG
struct MessageBubble_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 12) {
            MessageBubble(message: .sampleUser)
            MessageBubble(message: .sampleAssistant)
        }
        .padding()
    }
}
#endif

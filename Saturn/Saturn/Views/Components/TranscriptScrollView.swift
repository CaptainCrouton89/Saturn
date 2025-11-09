import SwiftUI

struct TranscriptScrollView: View {
    let messages: [Message]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
            }
            .onChange(of: messages.count) { oldValue, newValue in
                // Auto-scroll to bottom when new message added
                if let lastMessage = messages.last {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
        }
    }
}

#if DEBUG
struct TranscriptScrollView_Previews: PreviewProvider {
    static var previews: some View {
        TranscriptScrollView(messages: Message.sampleConversation)
    }
}
#endif

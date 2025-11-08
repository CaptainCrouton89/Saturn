import SwiftUI

struct ConversationView: View {
    @StateObject private var viewModel = ConversationViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Transcript
            TranscriptScrollView(messages: viewModel.messages)

            // Mic Button
            MicrophoneButton(
                state: viewModel.micState,
                action: {
                    if viewModel.micState == .idle {
                        viewModel.startRecording()
                    } else if viewModel.micState == .recording {
                        viewModel.stopRecording()
                    }
                }
            )
            .padding(.bottom, 40)
            .disabled(viewModel.micState == .processing)
        }
        .background(Color(.systemGroupedBackground))
    }
}

#Preview {
    ConversationView()
}

import SwiftUI

struct ConversationView: View {
    @StateObject private var viewModel = ConversationViewModel()

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Cosmo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("End") {
                        viewModel.endConversation()
                    }
                    .disabled(viewModel.conversationId == nil)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                }
            }
        }
    }
}

#if DEBUG
struct ConversationView_Previews: PreviewProvider {
    static var previews: some View {
        ConversationView()
    }
}
#endif

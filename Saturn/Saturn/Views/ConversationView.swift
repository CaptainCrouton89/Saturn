import SwiftUI

struct ConversationView: View {
    @StateObject private var viewModel = ConversationViewModel()

    #if os(iOS)
    private let toolbarPlacement: ToolbarItemPlacement = .navigationBarTrailing
    #else
    private let toolbarPlacement: ToolbarItemPlacement = .automatic
    #endif

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
            #if os(iOS)
            .background(Color(.systemGroupedBackground))
            #else
            .background(Color(nsColor: .windowBackgroundColor))
            #endif
            .navigationTitle("Cosmo")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: toolbarPlacement) {
                    Button("End") {
                        viewModel.endConversation()
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.conversationId == nil)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
                .buttonStyle(.plain)
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

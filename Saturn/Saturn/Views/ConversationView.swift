import SwiftUI

struct ConversationView: View {
    @StateObject private var viewModel = ConversationViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Transcript
            TranscriptScrollView(messages: viewModel.messages)

            // Live partial transcript (shown during recording)
            if !viewModel.currentTranscript.isEmpty {
                HStack {
                    Text(viewModel.currentTranscript)
                        .font(.body)
                        .foregroundColor(.secondary)
                        .italic()
                        .padding()
                    Spacer()
                }
                .background(Color(.systemGray6))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

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

#Preview {
    ConversationView()
}

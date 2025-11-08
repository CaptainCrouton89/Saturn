import SwiftUI

struct MicrophoneButton: View {
    let state: ConversationViewModel.MicState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(backgroundColor)
                    .frame(width: 80, height: 80)
                    .shadow(color: .black.opacity(0.2), radius: 8, y: 4)

                if state == .processing {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundColor(.white)
                }
            }
            .scaleEffect(state == .recording ? 1.1 : 1.0)
            .animation(
                state == .recording ?
                    .easeInOut(duration: 0.6).repeatForever(autoreverses: true) :
                    .easeOut(duration: 0.2),
                value: state
            )
        }
    }

    private var backgroundColor: Color {
        switch state {
        case .idle:
            return Color.blue
        case .recording:
            return Color.red
        case .processing:
            return Color.gray
        }
    }
}

#Preview {
    VStack(spacing: 40) {
        MicrophoneButton(state: .idle, action: {})
        MicrophoneButton(state: .recording, action: {})
        MicrophoneButton(state: .processing, action: {})
    }
}

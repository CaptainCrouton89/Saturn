//
//  PreIntroductionView.swift
//  Saturn
//
//  Microphone permission and ready-to-start prompt
//

import SwiftUI
import AVFoundation

struct PreIntroductionView: View {
    let onStart: () -> Void
    let onBack: () -> Void

    @State private var microphonePermissionGranted = false
    @State private var showingPermissionDeniedAlert = false

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // Microphone Icon
            Text("🎤")
                .font(.system(size: 80))

            // Permission Explanation
            Text("This app needs microphone access to run")
                .font(.title2)
                .fontWeight(.semibold)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Text("Cosmo listens to you speak and asks thoughtful questions to help you think out loud.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            // Ready prompt (only show after permission granted)
            if microphonePermissionGranted {
                VStack(spacing: 20) {
                    Text("Ready to introduce yourself?")
                        .font(.title3)
                        .fontWeight(.medium)

                    // Start Button
                    Button(action: onStart) {
                        Text("Start")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 40)

                    // Back Button
                    Button(action: onBack) {
                        Text("Back")
                            .font(.headline)
                            .foregroundColor(.blue)
                    }
                }
            } else {
                // Request Permission Button
                Button(action: requestMicrophonePermission) {
                    Text("Allow Microphone Access")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 40)

                // Back Button
                Button(action: onBack) {
                    Text("Back")
                        .font(.headline)
                        .foregroundColor(.blue)
                }
            }

            Spacer()
        }
        .onAppear {
            checkMicrophonePermission()
        }
        .alert("Microphone Access Required", isPresented: $showingPermissionDeniedAlert) {
            Button("Open Settings", action: openSettings)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Please enable microphone access in Settings to use Cosmo.")
        }
    }

    private func checkMicrophonePermission() {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            microphonePermissionGranted = true
        case .denied, .undetermined:
            microphonePermissionGranted = false
        @unknown default:
            microphonePermissionGranted = false
        }
    }

    private func requestMicrophonePermission() {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                if granted {
                    microphonePermissionGranted = true
                } else {
                    showingPermissionDeniedAlert = true
                }
            }
        }
    }

    private func openSettings() {
        if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(settingsUrl)
        }
    }
}

#if DEBUG
struct PreIntroductionView_Previews: PreviewProvider {
    static var previews: some View {
        PreIntroductionView(onStart: {}, onBack: {})
    }
}
#endif

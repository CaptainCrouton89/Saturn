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
            Image(systemName: "mic.fill")
                .font(.system(size: 80))
                .foregroundColor(.blue)

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
                    .buttonStyle(.plain)
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
                .buttonStyle(.plain)
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
        #if os(iOS)
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            microphonePermissionGranted = true
        case .denied, .undetermined:
            microphonePermissionGranted = false
        @unknown default:
            microphonePermissionGranted = false
        }
        #else
        // macOS: Check via AVCaptureDevice
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            microphonePermissionGranted = true
        case .denied, .restricted, .notDetermined:
            microphonePermissionGranted = false
        @unknown default:
            microphonePermissionGranted = false
        }
        #endif
    }

    private func requestMicrophonePermission() {
        #if os(iOS)
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                if granted {
                    microphonePermissionGranted = true
                } else {
                    showingPermissionDeniedAlert = true
                }
            }
        }
        #else
        // macOS: Request via AVCaptureDevice
        Task {
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            await MainActor.run {
                if granted {
                    microphonePermissionGranted = true
                } else {
                    showingPermissionDeniedAlert = true
                }
            }
        }
        #endif
    }

    private func openSettings() {
        #if os(iOS)
        if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(settingsUrl)
        }
        #else
        // macOS: Open System Settings
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
        #endif
    }
}

#if DEBUG
struct PreIntroductionView_Previews: PreviewProvider {
    static var previews: some View {
        PreIntroductionView(onStart: {}, onBack: {})
    }
}
#endif

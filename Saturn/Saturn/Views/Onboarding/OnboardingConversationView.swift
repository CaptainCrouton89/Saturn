//
//  OnboardingConversationView.swift
//  Saturn
//
//  Onboarding conversation with completion handling
//

import SwiftUI

struct OnboardingConversationView: View {
    @StateObject private var viewModel = OnboardingConversationViewModel()
    let onComplete: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Transcript
                TranscriptScrollView(messages: viewModel.messages)

                // Show completion UI if onboarding is done
                // Wrap in Group with disabled animation to prevent layout oscillation
                Group {
                    if viewModel.isOnboardingComplete {
                        VStack(spacing: 20) {
                            Text("You're all set!")
                                .font(.headline)
                                .foregroundColor(.secondary)

                            Button(action: {
                                viewModel.completeOnboarding()
                                onComplete()
                            }) {
                                Text("Continue")
                                    .font(.headline)
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .padding()
                                    .background(Color.blue)
                                    .cornerRadius(12)
                            }
                            .padding(.horizontal, 40)
                        }
                        .padding(.bottom, 40)
                        .transition(.opacity)
                    } else {
                        // Mic Button (normal conversation UI)
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
                        .transition(.opacity)
                    }
                }
                .animation(nil, value: viewModel.isOnboardingComplete)
            }
            #if os(iOS)
            .background(Color(.systemGroupedBackground))
            #else
            .background(Color(nsColor: .windowBackgroundColor))
            #endif
            .navigationTitle("Getting Started")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                }
            }
            .onAppear {
                viewModel.beginOnboardingConversation()
            }
            .onDisappear {
                viewModel.stopRecording()
            }
        }
    }
}

#if DEBUG
struct OnboardingConversationView_Previews: PreviewProvider {
    static var previews: some View {
        OnboardingConversationView(onComplete: {})
    }
}
#endif

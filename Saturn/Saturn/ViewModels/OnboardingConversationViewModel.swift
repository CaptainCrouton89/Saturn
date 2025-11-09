//
//  OnboardingConversationViewModel.swift
//  Saturn
//
//  Handles onboarding conversation with special completion logic
//

import Foundation
import Combine
import SwiftUI

@MainActor
class OnboardingConversationViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var micState: ConversationViewModel.MicState = .idle
    @Published var currentTranscript: String = ""
    @Published var isWaitingForResponse: Bool = false
    @Published var errorMessage: String?
    @Published var isOnboardingComplete: Bool = false

    // Real services
    private let conversationService = ConversationService.shared
    private let sttService = AssemblyAIService()
    private let audioService = AudioRecordingService()
    private let authService = AuthenticationService.shared

    // Conversation state
    private(set) var conversationId: String?
    private var turnNumber: Int = 0
    private var hasRequestedInitialPrompt = false
    private var isRequestingInitialPrompt = false

    // MARK: - Public Methods

    func beginOnboardingConversation() {
        Task {
            await initializeOnboardingConversation()
        }
    }

    func startRecording() {
        guard !isOnboardingComplete else { return }
        guard micState != .recording else { return }
        guard !isRequestingInitialPrompt else { return }
        if !hasRequestedInitialPrompt {
            beginOnboardingConversation()
            return
        }

        micState = .recording
        currentTranscript = ""
        errorMessage = nil

        Task {
            do {
                try await createConversationIfNeeded()

                // 2. Start AssemblyAI streaming
                try await sttService.startStreaming(
                    onPartial: { [weak self] transcript in
                        Task { @MainActor in
                            self?.currentTranscript = transcript
                        }
                    },
                    onFinal: { [weak self] transcript in
                        Task { @MainActor in
                            await self?.handleFinalTranscript(transcript)
                        }
                    },
                    onError: { [weak self] error in
                        Task { @MainActor in
                            self?.handleError(error)
                        }
                    }
                )

                // 3. Start audio recording
                try await audioService.startRecording { [weak self] audioChunk in
                    Task {
                        try? await self?.sttService.sendAudioChunk(audioChunk)
                    }
                }

            } catch {
                handleError(error)
            }
        }
    }

    func stopRecording() {
        micState = .idle
        Task {
            await audioService.stopRecording()
            await sttService.stopStreaming()
        }
    }

    func completeOnboarding() {
        Task {
            do {
                // Mark onboarding as complete on backend
                try await authService.completeOnboarding()
                print("✅ Onboarding marked complete")

                // End the conversation
                if let conversationId = conversationId {
                    try await conversationService.endConversation(conversationId: conversationId)
                    print("✅ Onboarding conversation ended")
                }
            } catch {
                print("❌ Failed to complete onboarding: \(error)")
                errorMessage = "Failed to complete setup. Please try again."
            }
        }
    }

    // MARK: - Private Methods

    private func handleFinalTranscript(_ transcript: String) async {
        guard !transcript.isEmpty else {
            micState = .idle
            return
        }

        micState = .processing
        currentTranscript = ""

        // Add user message
        let userMessage = Message(role: .user, text: transcript)
        messages.append(userMessage)

        // Send to backend
        do {
            try await sendToBackend(userMessage: transcript)
        } catch {
            handleError(error)
            micState = .idle
            isWaitingForResponse = false
        }
    }

    private func sendToBackend(userMessage: String, shouldAutoRestartRecording: Bool = true) async throws {
        guard let conversationId = conversationId else {
            micState = .idle
            throw ConversationError.notAuthenticated
        }

        turnNumber += 1
        isWaitingForResponse = true

        do {
            let response = try await conversationService.sendExchange(
                conversationId: conversationId,
                userMessage: userMessage,
                turnNumber: turnNumber
            )

            let assistantMessage = Message(role: .assistant, text: response.data.response.text)
            messages.append(assistantMessage)

            if response.data.response.onboardingComplete == true {
                isOnboardingComplete = true
                micState = .idle
                isWaitingForResponse = false

                Task {
                    await audioService.stopRecording()
                    await sttService.stopStreaming()
                }

                return
            }

            isWaitingForResponse = false

            if shouldAutoRestartRecording {
                startRecording()
            } else {
                micState = .idle
            }

        } catch {
            micState = .idle
            isWaitingForResponse = false
            throw error
        }
    }

    private func initializeOnboardingConversation() async {
        do {
            if !hasRequestedInitialPrompt {
                micState = .processing
            }
            try await createConversationIfNeeded()
            try await requestInitialPromptIfNeeded()
        } catch {
            handleError(error)
        }
    }

    private func createConversationIfNeeded() async throws {
        guard conversationId == nil else { return }

        do {
            let response = try await conversationService.createConversation(triggerMethod: "onboarding")
            conversationId = response.data.conversation.id
            print("✅ Onboarding conversation created: \(response.data.conversation.id)")
        } catch {
            print("❌ Failed to create onboarding conversation: \(error)")
            throw error
        }
    }

    private func requestInitialPromptIfNeeded() async throws {
        guard !hasRequestedInitialPrompt else { return }
        guard !isRequestingInitialPrompt else { return }

        isRequestingInitialPrompt = true
        defer { isRequestingInitialPrompt = false }

        do {
            try await sendToBackend(userMessage: "", shouldAutoRestartRecording: false)
            hasRequestedInitialPrompt = true
            micState = .idle
        } catch {
            throw error
        }
    }

    private func handleError(_ error: Error) {
        print("❌ Error: \(error.localizedDescription)")
        errorMessage = error.localizedDescription
        micState = .idle
    }
}

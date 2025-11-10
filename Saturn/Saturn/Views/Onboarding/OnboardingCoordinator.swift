//
//  OnboardingCoordinator.swift
//  Saturn
//
//  Manages the onboarding flow state and navigation
//

import SwiftUI

enum OnboardingStep {
    case welcome
    case preIntroduction
    case introConversation
}

struct OnboardingCoordinator: View {
    @State private var currentStep: OnboardingStep = .welcome
    @State private var showingIntroConversation = false

    let onComplete: () -> Void

    var body: some View {
        ZStack {
            switch currentStep {
            case .welcome:
                WelcomeView(onBegin: {
                    currentStep = .preIntroduction
                })
                .transition(.opacity)

            case .preIntroduction:
                PreIntroductionView(
                    onStart: {
                        showingIntroConversation = true
                    },
                    onBack: {
                        currentStep = .welcome
                    }
                )
                .transition(.opacity)

            case .introConversation:
                // This will be handled by fullScreenCover
                EmptyView()
            }
        }
        .animation(.easeInOut, value: currentStep)
        #if os(iOS)
        .fullScreenCover(isPresented: $showingIntroConversation) {
            OnboardingConversationView(onComplete: {
                showingIntroConversation = false
                onComplete()
            })
        }
        #else
        .sheet(isPresented: $showingIntroConversation) {
            OnboardingConversationView(onComplete: {
                showingIntroConversation = false
                onComplete()
            })
        }
        #endif
    }
}

#if DEBUG
struct OnboardingCoordinator_Previews: PreviewProvider {
    static var previews: some View {
        OnboardingCoordinator(onComplete: {})
    }
}
#endif

//
//  SaturnApp.swift
//  Saturn
//
//  Created by Silas Rhyneer on 11/8/25.
//

import SwiftUI
import Combine

@main
struct SaturnApp: App {
    @StateObject private var appState = AppState()

    init() {
        // Initialize device ID on app launch (generates or retrieves from Keychain)
        let deviceID = DeviceIDManager.shared.getDeviceID()
        print("Saturn: Device ID initialized - \(deviceID)")
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if appState.isLoading {
                    // Loading screen while checking auth & onboarding status
                    VStack {
                        ProgressView()
                        Text("Loading...")
                            .foregroundColor(.secondary)
                            .padding(.top)
                    }
                } else if appState.needsOnboarding {
                    // Show onboarding flow for new users
                    OnboardingCoordinator(onComplete: {
                        appState.completeOnboarding()
                    })
                } else {
                    // Show main app for existing users
                    MainTabView()
                }
            }
            .onAppear {
                Task {
                    await appState.initialize()
                }
            }
        }
    }
}

/// Manages app-level state (authentication, onboarding status)
@MainActor
class AppState: ObservableObject {
    @Published var isLoading = true
    @Published var needsOnboarding = false

    func initialize() async {
        do {
            // Authenticate device with backend
            try await AuthenticationService.shared.authenticateDevice()
            print("Saturn: Device authenticated successfully")

            // Check onboarding status
            let userProfile = try await AuthenticationService.shared.getUserProfile()
            needsOnboarding = !userProfile.onboardingCompleted

            print("Saturn: Onboarding needed: \(needsOnboarding)")
        } catch {
            print("Saturn: Failed to initialize - \(error.localizedDescription)")
            // If auth fails, assume needs onboarding
            needsOnboarding = true
        }

        isLoading = false
    }

    func completeOnboarding() {
        needsOnboarding = false
    }
}

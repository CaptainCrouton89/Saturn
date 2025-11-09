//
//  SaturnApp.swift
//  Saturn
//
//  Created by Silas Rhyneer on 11/8/25.
//

import SwiftUI

@main
struct SaturnApp: App {
    init() {
        // Initialize device ID on app launch (generates or retrieves from Keychain)
        let deviceID = DeviceIDManager.shared.getDeviceID()
        print("Saturn: Device ID initialized - \(deviceID)")

        // Authenticate device with backend
        Task {
            do {
                try await AuthenticationService.shared.authenticateDevice()
                print("Saturn: Device authenticated successfully")
            } catch {
                print("Saturn: Failed to authenticate device - \(error.localizedDescription)")
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            MainTabView()
        }
    }
}

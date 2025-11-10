//
//  WelcomeView.swift
//  Saturn
//
//  Onboarding welcome/landing screen
//

import SwiftUI

struct WelcomeView: View {
    let onBegin: () -> Void

    var body: some View {
        VStack(spacing: 40) {
            Spacer()

            // App Icon/Logo
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 80))
                .foregroundColor(.blue)

            // Title
            Text("Welcome to Cosmo")
                .font(.largeTitle)
                .fontWeight(.bold)

            // Tagline
            Text("I ask questions, you think out loud")
                .font(.title3)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            // Begin Button
            Button(action: onBegin) {
                Text("Begin")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
    }
}

#if DEBUG
struct WelcomeView_Previews: PreviewProvider {
    static var previews: some View {
        WelcomeView(onBegin: {})
    }
}
#endif

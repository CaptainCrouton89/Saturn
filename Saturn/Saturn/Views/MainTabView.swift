import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            ConversationView()
                .tabItem {
                    Label("Talk", systemImage: "mic.fill")
                }

            ArchiveView()
                .tabItem {
                    Label("Archive", systemImage: "list.bullet")
                }
        }
    }
}

#Preview {
    MainTabView()
}

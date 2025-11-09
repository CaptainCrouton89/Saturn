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

#if DEBUG
struct MainTabView_Previews: PreviewProvider {
    static var previews: some View {
        MainTabView()
    }
}
#endif

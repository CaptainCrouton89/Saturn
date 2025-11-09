import SwiftUI

struct ArchiveView: View {
    @StateObject private var viewModel = ArchiveViewModel()

    var body: some View {
        NavigationView {
            List(viewModel.conversations) { conversation in
                VStack(alignment: .leading, spacing: 4) {
                    Text(conversation.summary)
                        .font(.headline)
                    Text(conversation.date, style: .date)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Past Conversations")
        }
    }
}

#if DEBUG
struct ArchiveView_Previews: PreviewProvider {
    static var previews: some View {
        ArchiveView()
    }
}
#endif

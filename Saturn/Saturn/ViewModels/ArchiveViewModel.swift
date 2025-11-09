import Foundation
import Combine

@MainActor
class ArchiveViewModel: ObservableObject {
    @Published var conversations: [ConversationSummary] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    init() {
        // Fetch conversations on initialization
        Task {
            await loadConversations()
        }
    }

    /// Load conversations from backend
    func loadConversations() async {
        isLoading = true
        errorMessage = nil

        do {
            // Fetch completed conversations only (archive view)
            let fetchedConversations = try await ConversationService.shared.fetchConversations(
                limit: 50,
                offset: 0,
                status: "completed"
            )
            self.conversations = fetchedConversations
        } catch {
            print("ArchiveViewModel: Failed to load conversations - \(error.localizedDescription)")
            errorMessage = "Failed to load conversations: \(error.localizedDescription)"
            // Keep conversations empty on error
            self.conversations = []
        }

        isLoading = false
    }

    /// Refresh conversations
    func refresh() async {
        await loadConversations()
    }
}

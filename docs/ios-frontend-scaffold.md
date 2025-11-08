# iOS Frontend Scaffold Plan

**Project:** Cosmo (Saturn iOS App)
**Purpose:** Voice-first AI companion with Socratic questioning
**Scope:** UI-only proof of concept with mocked services
**Last Updated:** 2025-11-08

---

## Overview

This document outlines the architecture and implementation plan for the Cosmo iOS frontend. The scaffold focuses on building a complete UI with mocked conversation services, establishing the foundation for later integration with AssemblyAI (STT), ElevenLabs (TTS), and the Saturn backend API.

### Key Design Decisions

- **Platform:** iOS-only, SwiftUI
- **State Management:** Simple `@StateObject` + `@Published` pattern
- **Voice Stack:** ElevenLabs TTS + AssemblyAI STT (integration phase 2)
- **Backend:** Express API at `/backend/src/` (Neo4j + PostgreSQL)
- **Conversation Lifecycle:** Ephemeral (backend is source of truth)
- **Navigation:** Tab-based (Conversation + Archive)
- **Transcript UI:** Scrolling chat bubbles (user/assistant)
- **Audio Playback:** Wait for full response before playing
- **Turn-Taking:** Auto-reactivate mic after Cosmo responds
- **Context Loading:** Skipped for MVP
- **Authentication:** UUID-based (no login for proof of concept)

---

## Architecture Summary

### Tech Stack

**Frontend:**
- SwiftUI (iOS 17+)
- Combine for state management
- AVFoundation for audio (future)
- Native URLSession for API calls

**Backend (Already Built):**
- Express + TypeScript
- Neo4j for knowledge graph
- PostgreSQL for conversation storage (via Supabase)
- Endpoints: `/api/graph/*` (see `backend/src/routes/graph.ts`)

**External Services (Phase 2):**
- AssemblyAI: Real-time speech-to-text
- ElevenLabs: Text-to-speech with streaming

### Navigation Structure

```
SaturnApp
└── MainTabView
    ├── ConversationView (Tab 1)
    │   ├── TranscriptScrollView
    │   │   └── MessageBubble (repeated)
    │   └── MicrophoneButton
    └── ArchiveView (Tab 2)
        └── List of ConversationSummary
```

---

## File Structure

```
Saturn/
├── SaturnApp.swift                   # App entry point → MainTabView
├── Models/
│   ├── Message.swift                 # Message model (user/assistant)
│   └── ConversationSummary.swift     # Archive list item (id, summary, date)
├── ViewModels/
│   ├── ConversationViewModel.swift   # Main conversation state (mocked)
│   └── ArchiveViewModel.swift        # Mock past conversations
├── Views/
│   ├── MainTabView.swift             # TabView container
│   ├── ConversationView.swift        # Main screen (transcript + mic)
│   ├── ArchiveView.swift             # Past conversations list
│   └── Components/
│       ├── MessageBubble.swift       # Chat bubble component
│       ├── MicrophoneButton.swift    # Animated mic with states
│       └── TranscriptScrollView.swift # Auto-scrolling message list
└── Services/
    └── MockConversationService.swift # Mocked responses with delays
```

---

## Component Specifications

### 1. Message Model

**File:** `Models/Message.swift`

```swift
import Foundation

struct Message: Identifiable, Equatable {
    let id: UUID
    let role: Role
    let text: String
    let timestamp: Date

    enum Role {
        case user
        case assistant
    }

    init(id: UUID = UUID(), role: Role, text: String, timestamp: Date = Date()) {
        self.id = id
        self.role = role
        self.text = text
        self.timestamp = timestamp
    }
}
```

**Properties:**
- `id`: Unique identifier for SwiftUI lists
- `role`: User or assistant (determines bubble styling/alignment)
- `text`: Message content
- `timestamp`: When message was sent (for future use)

---

### 2. ConversationSummary Model

**File:** `Models/ConversationSummary.swift`

```swift
import Foundation

struct ConversationSummary: Identifiable, Equatable {
    let id: UUID
    let summary: String
    let date: Date
}
```

**Purpose:** Represents a past conversation in the archive list.

---

### 3. ConversationViewModel

**File:** `ViewModels/ConversationViewModel.swift`

**Responsibilities:**
- Manage conversation state (messages, mic state)
- Handle mock user input and responses
- Orchestrate turn-taking logic
- Auto-reactivate mic after Cosmo responds

**State Properties:**
```swift
@Published var messages: [Message] = []
@Published var micState: MicState = .idle
@Published var isWaitingForResponse: Bool = false

enum MicState {
    case idle        // Ready to record
    case recording   // User is speaking
    case processing  // Waiting for Cosmo response
}
```

**Public Methods:**
```swift
func startRecording()              // Transition to .recording state
func stopRecording()               // Transition to .processing, add user message
func sendMessage(_ text: String)   // Add user message, trigger mock response
func resetConversation()           // Clear messages array
```

**Private Methods:**
```swift
private func handleMockResponse() async {
    // Delay 1-2 seconds (simulate API call)
    // Add assistant message from mock response pool
    // Transition back to .idle (auto-reactivate mic)
}
```

**Mock Response Pool:**
```swift
private let mockResponses = [
    "That's interesting. Can you tell me more about that?",
    "How does that make you feel?",
    "What do you think led to that?",
    "I'm curious—what's the bigger picture here?",
    "That sounds challenging. What's been the hardest part?",
    "I see. What would you like to happen next?",
    "Tell me more about that.",
    "What's been on your mind about this?",
    "How long has this been something you've thought about?",
    "What matters most to you here?"
]
```

**Behavior:**
1. User taps mic → `startRecording()` → state = `.recording`
2. User taps again → `stopRecording()` → state = `.processing`, add user message
3. Delay 1.5s → `handleMockResponse()` → add random assistant message
4. State returns to `.idle` (mic auto-reactivates for next turn)

---

### 4. ArchiveViewModel

**File:** `ViewModels/ArchiveViewModel.swift`

**Responsibilities:**
- Provide mock past conversations for archive list

**State:**
```swift
@Published var conversations: [ConversationSummary] = []
```

**Initialization:**
```swift
init() {
    // Load mock conversations
    self.conversations = [
        ConversationSummary(
            id: UUID(),
            summary: "Talked about work stress and upcoming deadlines",
            date: Date()
        ),
        ConversationSummary(
            id: UUID(),
            summary: "Ideas for side project - AI voice app",
            date: Date().addingTimeInterval(-86400) // Yesterday
        ),
        ConversationSummary(
            id: UUID(),
            summary: "Relationship thoughts and communication",
            date: Date().addingTimeInterval(-172800) // 2 days ago
        ),
        ConversationSummary(
            id: UUID(),
            summary: "Career decisions and life direction",
            date: Date().addingTimeInterval(-259200) // 3 days ago
        )
    ]
}
```

---

### 5. MainTabView

**File:** `Views/MainTabView.swift`

**Purpose:** Tab container for Conversation and Archive views.

```swift
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
```

---

### 6. ConversationView

**File:** `Views/ConversationView.swift`

**Layout:**
```
┌─────────────────────────────┐
│  Navigation Bar (optional)  │
├─────────────────────────────┤
│                              │
│  [TranscriptScrollView]     │
│   - MessageBubble (User)    │
│   - MessageBubble (Cosmo)   │
│   - MessageBubble (User)    │
│   - ...                      │
│                              │
│  [Spacer to push down]      │
│                              │
│  [MicrophoneButton]          │ ← Bottom center, large
│                              │
└─────────────────────────────┘
```

**Structure:**
```swift
import SwiftUI

struct ConversationView: View {
    @StateObject private var viewModel = ConversationViewModel()

    var body: some View {
        VStack(spacing: 0) {
            // Transcript
            TranscriptScrollView(messages: viewModel.messages)

            // Mic Button
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
        }
        .background(Color(.systemGroupedBackground))
    }
}
```

**Behavior:**
- Mic button disabled during `.processing` state
- Transcript auto-scrolls to bottom when new message added
- Empty state shows mic button centered (no messages yet)

---

### 7. TranscriptScrollView

**File:** `Views/Components/TranscriptScrollView.swift`

**Purpose:** Auto-scrolling message list with chat bubbles.

```swift
import SwiftUI

struct TranscriptScrollView: View {
    let messages: [Message]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
            }
            .onChange(of: messages.count) { _ in
                // Auto-scroll to bottom when new message added
                if let lastMessage = messages.last {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
        }
    }
}
```

**Features:**
- LazyVStack for performance with long conversations
- Auto-scroll to bottom with smooth animation
- 12pt vertical spacing between bubbles

---

### 8. MessageBubble

**File:** `Views/Components/MessageBubble.swift`

**Purpose:** Individual chat bubble with role-based styling.

```swift
import SwiftUI

struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                // Assistant bubble (left-aligned)
                bubbleContent
                    .background(Color(.systemGray5))
                    .foregroundColor(.primary)
                Spacer()
            } else {
                // User bubble (right-aligned)
                Spacer()
                bubbleContent
                    .background(Color.blue)
                    .foregroundColor(.white)
            }
        }
    }

    private var bubbleContent: some View {
        Text(message.text)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}
```

**Styling:**
- **User messages:** Blue background, white text, right-aligned
- **Assistant messages:** Light gray background, primary text, left-aligned
- 18pt corner radius for rounded bubbles
- 16pt horizontal padding, 10pt vertical padding

**Optional Enhancements (Future):**
- Avatar icons
- Timestamps (small text below bubble)
- Typing indicator for assistant

---

### 9. MicrophoneButton

**File:** `Views/Components/MicrophoneButton.swift`

**Purpose:** Large, animated microphone button with state-based visuals.

```swift
import SwiftUI

struct MicrophoneButton: View {
    let state: ConversationViewModel.MicState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(backgroundColor)
                    .frame(width: 80, height: 80)
                    .shadow(color: .black.opacity(0.2), radius: 8, y: 4)

                if state == .processing {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundColor(.white)
                }
            }
            .scaleEffect(state == .recording ? 1.1 : 1.0)
            .animation(
                state == .recording ?
                    .easeInOut(duration: 0.6).repeatForever(autoreverses: true) :
                    .easeOut(duration: 0.2),
                value: state
            )
        }
    }

    private var backgroundColor: Color {
        switch state {
        case .idle:
            return Color.blue
        case .recording:
            return Color.red
        case .processing:
            return Color.gray
        }
    }
}
```

**States:**
- **Idle:** Blue background, mic icon, static
- **Recording:** Red background, pulsing scale animation
- **Processing:** Gray background, spinner replaces mic icon

**Animation:**
- Pulsing: Scale 1.0 → 1.1 → 1.0 (0.6s duration, repeating)
- State transition: Smooth 0.2s ease-out

---

### 10. ArchiveView

**File:** `Views/ArchiveView.swift`

**Purpose:** List of past conversations (mocked for MVP).

```swift
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
```

**Features:**
- List of conversation summaries
- Shows date in readable format
- Navigation title "Past Conversations"

**Future Enhancement:**
- Tap conversation to navigate to detail view (full transcript)
- Pull to refresh (fetch from backend)
- Search/filter

---

### 11. MockConversationService

**File:** `Services/MockConversationService.swift`

**Purpose:** Simulate backend API responses with realistic delays.

```swift
import Foundation

actor MockConversationService {
    private let responses = [
        "That's interesting. Can you tell me more about that?",
        "How does that make you feel?",
        "What do you think led to that?",
        "I'm curious—what's the bigger picture here?",
        "That sounds challenging. What's been the hardest part?",
        "I see. What would you like to happen next?",
        "Tell me more about that.",
        "What's been on your mind about this?",
        "How long has this been something you've thought about?",
        "What matters most to you here?"
    ]

    private var currentIndex = 0

    func getResponse(for userMessage: String) async -> String {
        // Simulate network delay
        try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds

        // Cycle through responses
        let response = responses[currentIndex]
        currentIndex = (currentIndex + 1) % responses.count

        return response
    }
}
```

**Usage in ConversationViewModel:**
```swift
private let mockService = MockConversationService()

private func handleMockResponse() async {
    let response = await mockService.getResponse(for: "user input")
    let assistantMessage = Message(role: .assistant, text: response)

    await MainActor.run {
        self.messages.append(assistantMessage)
        self.micState = .idle // Auto-reactivate mic
    }
}
```

---

## Interaction Flow (Mocked)

### First Conversation Flow

1. **App opens** → MainTabView appears, default to ConversationView
2. **Initial state:** Empty transcript, blue mic button (idle)
3. **User taps mic:**
   - Mic turns red
   - State = `.recording`
   - Pulsing animation starts
4. **User taps mic again:**
   - State = `.processing`
   - User message added to transcript: "I'm feeling stressed about work"
   - Mic shows spinner (gray background)
5. **Delay 1.5s:**
   - Cosmo message added: "That's tough. What's been the hardest part?"
   - State = `.idle` (mic turns blue again)
6. **Auto-reactivate:**
   - Mic is ready for next turn
   - User can tap to continue conversation
7. **Repeat:** Build up conversation transcript with alternating turns

### Archive Tab Flow

1. **User taps Archive tab** → ArchiveView appears
2. **Shows mock conversations:**
   - "Talked about work stress and upcoming deadlines" (Today)
   - "Ideas for side project - AI voice app" (Yesterday)
   - "Relationship thoughts and communication" (2 days ago)
   - Etc.
3. **Tap conversation (future):** Navigate to detail view showing full transcript

---

## Visual Design Specifications

### Color Palette

**Main Colors:**
- Background: `Color(.systemGroupedBackground)` (light gray)
- User bubble: `Color.blue` (#007AFF iOS default)
- Assistant bubble: `Color(.systemGray5)` (light gray)
- Mic idle: `Color.blue`
- Mic recording: `Color.red` (#FF3B30 iOS red)
- Mic processing: `Color.gray`

**Text Colors:**
- User bubble text: `.white`
- Assistant bubble text: `.primary`
- Archive subtitle: `.secondary`

### Typography

**Message Text:**
- Font: System default
- Size: 16pt (body)
- Weight: Regular

**Archive Summary:**
- Font: System default
- Size: 17pt (headline)
- Weight: Semibold

**Archive Date:**
- Font: System default
- Size: 12pt (caption)
- Weight: Regular
- Color: Secondary

### Spacing & Sizing

**Message Bubbles:**
- Corner radius: 18pt
- Horizontal padding: 16pt
- Vertical padding: 10pt
- Vertical spacing between bubbles: 12pt

**Mic Button:**
- Diameter: 80pt
- Icon size: 32pt
- Bottom padding: 40pt
- Shadow: 8pt blur, 4pt y-offset, 20% opacity

**Tab Bar:**
- iOS default (no custom styling for MVP)

---

## State Management Patterns

### ConversationViewModel State Flow

```
[User taps mic]
    ↓
micState = .recording
    ↓
[User taps mic again]
    ↓
micState = .processing
messages.append(userMessage)
    ↓
[Async: handleMockResponse()]
    ↓
await Task.sleep(1.5s)
    ↓
messages.append(assistantMessage)
micState = .idle  ← Auto-reactivate
```

### Message Update Pattern

```swift
// ViewModel
@Published var messages: [Message] = []

// View
TranscriptScrollView(messages: viewModel.messages)

// Update triggers:
// 1. User message → stopRecording()
// 2. Assistant message → handleMockResponse()
// 3. Both trigger SwiftUI re-render
```

---

## Testing Checklist

### UI Functionality
- [ ] Mic button toggles between idle/recording/processing states
- [ ] User messages appear right-aligned with blue background
- [ ] Assistant messages appear left-aligned with gray background
- [ ] Transcript auto-scrolls to bottom when new message added
- [ ] Mock responses have realistic delay (~1.5s)
- [ ] Mic auto-reactivates after Cosmo responds
- [ ] Mic button disabled during processing state
- [ ] Pulsing animation works during recording

### Navigation
- [ ] Tab switching between Conversation and Archive works
- [ ] Archive shows mock conversation list
- [ ] Conversation state persists when switching tabs
- [ ] Tab bar icons and labels display correctly

### Edge Cases
- [ ] Empty conversation state looks good (just mic button)
- [ ] Long messages wrap correctly in bubbles
- [ ] Very long conversation scrolls smoothly
- [ ] Rapid mic tapping doesn't break state
- [ ] Switching tabs mid-conversation doesn't crash

### Visual Polish
- [ ] Layout works on different iPhone sizes (SE, Pro, Pro Max)
- [ ] Dark mode appearance is acceptable
- [ ] Animations are smooth (no stuttering)
- [ ] Colors match design spec
- [ ] Spacing and padding feel balanced

---

## Future Integration Points

When ready to integrate real services, the following changes are needed:

### Phase 2: AssemblyAI STT Integration

**New File:** `Services/STTService.swift`

```swift
// Replace MockConversationService with real STT
actor STTService {
    func startStreaming(onResult: @escaping (String, Bool) -> Void) async {
        // Connect to AssemblyAI real-time API
        // Stream audio from microphone
        // Call onResult with interim/final transcripts
    }

    func stopStreaming() {
        // Close connection
    }
}
```

**Update ConversationViewModel:**
```swift
func startRecording() {
    micState = .recording
    Task {
        await sttService.startStreaming { transcript, isFinal in
            if isFinal {
                self.sendMessage(transcript)
            }
        }
    }
}
```

---

### Phase 3: ElevenLabs TTS Integration

**New File:** `Services/TTSService.swift`

```swift
actor TTSService {
    func synthesize(_ text: String) async throws -> Data {
        // Call ElevenLabs API
        // Return audio data
    }
}

actor AudioPlayer {
    func play(_ audioData: Data) async {
        // Play audio using AVAudioPlayer
    }
}
```

**Update ConversationViewModel:**
```swift
private func handleResponse(_ text: String) async {
    let audioData = try? await ttsService.synthesize(text)

    // Add assistant message
    await MainActor.run {
        messages.append(Message(role: .assistant, text: text))
    }

    // Play audio
    if let audioData = audioData {
        await audioPlayer.play(audioData)
    }

    // Auto-reactivate mic after audio finishes
    await MainActor.run {
        micState = .idle
    }
}
```

---

### Phase 4: Backend API Integration

**New File:** `Services/APIService.swift`

```swift
actor APIService {
    private let baseURL = "http://localhost:3001"
    private var userId: String // Load from UserDefaults or generate UUID

    func sendMessage(_ text: String, conversationId: String?) async throws -> ConversationTurn {
        let url = URL(string: "\(baseURL)/api/conversation/turn")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "userId": userId,
            "message": text,
            "conversationId": conversationId ?? NSNull()
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(ConversationTurnResponse.self, from: data)
        return response
    }

    func loadContext(days: Int = 14) async throws -> ConversationContext {
        let url = URL(string: "\(baseURL)/api/graph/users/\(userId)/context?days=\(days)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(ConversationContext.self, from: data)
    }
}
```

**Backend Endpoint to Add:**
```typescript
// backend/src/routes/conversation.ts
router.post('/conversation/turn', async (req, res) => {
  const { userId, message, conversationId } = req.body;

  // Load context (if first turn)
  const context = conversationId ? null : await loadContext(userId);

  // Call LLM with message + context
  const response = await llmService.chat(message, context);

  // Save turn to conversation
  const newConversationId = conversationId || generateId();
  await saveConversationTurn(newConversationId, userId, message, response);

  res.json({ text: response, conversationId: newConversationId });
});
```

---

### Phase 5: Onboarding Flow

**New Files:**
- `Views/Onboarding/WelcomeView.swift`
- `Views/Onboarding/PermissionsView.swift`
- `Views/Onboarding/NameInputView.swift`
- `Views/Onboarding/InitialQuestionsView.swift`
- `ViewModels/OnboardingViewModel.swift`

**Flow:**
```
App Launch
    ↓
Check UserDefaults.hasCompletedOnboarding
    ↓
If false → Show OnboardingFlow
    ↓
WelcomeView (explain concept)
    ↓
PermissionsView (request mic, notifications)
    ↓
NameInputView ("What's your name?")
    ↓
InitialQuestionsView ("What's on your mind?" + 1 more)
    ↓
Set hasCompletedOnboarding = true
    ↓
Transition to MainTabView
```

---

### Phase 6: Conversation Persistence

**Changes:**
- Add conversation save on app backgrounding
- POST to `/api/graph/conversations` with full transcript
- Load past conversations in ArchiveView from backend
- Add conversation detail view (tap archive item → full transcript)

**API Integration:**
```swift
func saveConversation(_ messages: [Message]) async throws {
    let url = URL(string: "\(baseURL)/api/graph/conversations")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let body: [String: Any] = [
        "id": UUID().uuidString,
        "summary": generateSummary(messages),
        "transcript": messages.map { ["role": $0.role, "text": $0.text] },
        "userId": userId
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (_, _) = try await URLSession.shared.data(for: request)
}
```

---

## Open Questions & Future Decisions

### Authentication
- **Current:** UUID in UserDefaults (no login)
- **Future:** Consider Apple Sign In for multi-device sync
- **Question:** When to introduce real auth? (Phase 6? Phase 7?)

### Error Handling
- **STT fails:** Show inline error message, allow retry
- **Backend down:** Show toast, queue messages for retry?
- **TTS fails:** Fall back to iOS native TTS or show text-only?
- **Question:** What's the UX for degraded modes?

### Context Pre-loading
- **MVP:** No context loading
- **Future:** Load on app open vs. first message?
- **Question:** Show loading indicator or invisible delay?

### Conversation Timeout
- **PRD:** Auto-end after 3-5min silence
- **Implementation:** Background timer? Foreground only?
- **Question:** Should user be notified before auto-save?

### Artifact Synthesis
- **PRD:** Rare, agent-initiated only
- **Implementation:** Backend determines when to offer?
- **Question:** How to surface this in iOS UI? (modal? inline suggestion?)

---

## Implementation Phases

### Phase 1: Static UI Scaffold (This Document)
**Duration:** 1-2 days
**Deliverables:**
- [ ] All model files created
- [ ] All view components built
- [ ] Mock conversation flow working
- [ ] Tab navigation functional
- [ ] Visual design matches spec

**Success Criteria:**
- User can tap mic, see mock conversation build up
- Archive shows mock past conversations
- UI looks polished and production-ready

---

### Phase 2: STT Integration
**Duration:** 2-3 days
**Deliverables:**
- [ ] AssemblyAI real-time STT service
- [ ] Microphone permission handling
- [ ] Audio streaming from device
- [ ] Real-time transcription display

**Success Criteria:**
- User speaks → words appear in real-time
- Final transcript is accurate
- Mic permissions handled gracefully

---

### Phase 3: TTS Integration
**Duration:** 2-3 days
**Deliverables:**
- [ ] ElevenLabs TTS service
- [ ] Audio playback with AVAudioPlayer
- [ ] Queue management (wait for full response)
- [ ] Playback completion callbacks

**Success Criteria:**
- Text → natural-sounding audio
- Audio plays smoothly without glitches
- Mic auto-reactivates after audio finishes

---

### Phase 4: Backend Integration
**Duration:** 3-4 days
**Deliverables:**
- [ ] APIService with conversation endpoints
- [ ] Conversation turn API endpoint (backend)
- [ ] Error handling and retries
- [ ] Network state management

**Success Criteria:**
- Full conversation flow: speak → STT → backend → TTS → hear response
- Conversations saved to backend
- Context loading working (if implemented)

---

### Phase 5: Onboarding & Polish
**Duration:** 2-3 days
**Deliverables:**
- [ ] Onboarding flow screens
- [ ] Permissions handling
- [ ] First-time user experience
- [ ] Visual polish and animations

**Success Criteria:**
- New users complete onboarding smoothly
- All permissions granted
- Seamless transition to first conversation

---

### Phase 6: Archive & Persistence
**Duration:** 2-3 days
**Deliverables:**
- [ ] Fetch past conversations from backend
- [ ] Conversation detail view
- [ ] Pull-to-refresh
- [ ] Conversation metadata (date, length, summary)

**Success Criteria:**
- Archive shows real conversation history
- User can browse and view past transcripts
- Data syncs correctly with backend

---

## Appendix: Code Snippets

### SaturnApp.swift (Entry Point)

```swift
import SwiftUI

@main
struct SaturnApp: App {
    var body: some Scene {
        WindowGroup {
            MainTabView()
        }
    }
}
```

---

### Constants.swift (Configuration)

```swift
import Foundation

enum Config {
    static let backendURL = "http://localhost:3001"
    static let mockDelay: TimeInterval = 1.5
    static let conversationTimeout: TimeInterval = 300 // 5 minutes
}

enum UserDefaultsKeys {
    static let userId = "userId"
    static let hasCompletedOnboarding = "hasCompletedOnboarding"
}
```

---

### Example Test Data

```swift
// For testing MessageBubble in previews
extension Message {
    static let sampleUser = Message(
        role: .user,
        text: "I've been feeling stressed about work lately"
    )

    static let sampleAssistant = Message(
        role: .assistant,
        text: "That sounds tough. What's been the hardest part?"
    )

    static let sampleConversation: [Message] = [
        .sampleUser,
        .sampleAssistant,
        Message(role: .user, text: "The deadlines keep piling up"),
        Message(role: .assistant, text: "How are you managing your time?"),
        Message(role: .user, text: "Not very well, to be honest"),
        Message(role: .assistant, text: "What would help you feel more in control?")
    ]
}
```

---

## Summary

This scaffold provides a complete, working iOS frontend with mocked conversation logic. The architecture is designed to make Phase 2-6 integrations straightforward—each real service (STT, TTS, API) can be swapped in without major refactoring.

**Key Strengths:**
- ✅ Clean separation of concerns (Views, ViewModels, Services)
- ✅ SwiftUI-native patterns (no external dependencies)
- ✅ Realistic mock behavior for testing UX flows
- ✅ Extensible architecture for future features
- ✅ Matches PRD requirements (voice-first, zero friction, turn-based)

**Next Steps:**
1. Implement Phase 1 (this scaffold)
2. Test on device with real user interaction
3. Gather feedback on UX flow
4. Proceed to Phase 2 (STT integration)

**Questions or clarifications?** Refer to specific sections above or consult the PRD (`docs/product-requirements.yaml`) and user flows (`docs/user-flows/`).

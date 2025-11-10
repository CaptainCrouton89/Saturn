# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Saturn** is the iOS native app for Cosmo, an AI companion focused on voice-first conversational engagement. The app handles real-time voice recording, streaming speech-to-text via AssemblyAI, backend communication for conversational AI responses, and conversation history.

**Tech Stack**: Swift 6.0+, SwiftUI, AVFoundation (audio), AssemblyAI (streaming STT), JWT authentication

**Project Path**: `/Users/silasrhyneer/Code/Cosmo/Saturn/Saturn/Saturn.xcodeproj`

## Build Commands

### Building
```bash
# From Saturn/ directory (contains .xcodeproj)
xcodebuild -project Saturn.xcodeproj -scheme Saturn -destination 'platform=iOS Simulator,name=iPhone 15' build

# Quick build check (shows first 20 lines including errors)
xcodebuild -project Saturn.xcodeproj -scheme Saturn -destination 'platform=macOS' build 2>&1 | grep -E "(BUILD SUCCEEDED|BUILD FAILED|error:)" | head -20
```

### Running
- Open `Saturn.xcodeproj` in Xcode
- Select iOS Simulator or device
- Cmd+R to run

### Configuration
The app requires environment variables in `.xcconfig` files (located in `Config/`):
- `API_BASE_URL`: Backend API endpoint (default: `http://localhost:3001` in Debug)
- `ASSEMBLYAI_API_KEY`: AssemblyAI API key for streaming STT

These are loaded via `Info.plist` and accessed through `Bundle.main.object(forInfoDictionaryKey:)` in services.

## High-Level Architecture

### MVVM Pattern
- **Views** (`Views/`): SwiftUI views for UI (ConversationView, ArchiveView, Onboarding flow)
- **ViewModels** (`ViewModels/`): Observable business logic (@Published state, service orchestration)
- **Services** (`Services/`): Singleton services for backend API, audio recording, STT, auth, device management
- **Models** (`Models/`): Data models (Message, ConversationSummary, User)

### Core Data Flow

**App Launch**:
1. `SaturnApp.swift` → `AppState.initialize()` → Check authentication + onboarding status
2. Route to `OnboardingCoordinator` (new users) or `MainTabView` (existing users)

**Conversation Flow** (ConversationViewModel orchestration):
1. User taps mic → `startRecording()`
2. Create conversation via `ConversationService.createConversation()` (async, non-blocking)
3. Start AssemblyAI WebSocket streaming (`AssemblyAIService.startStreaming()`)
4. Start microphone capture (`AudioRecordingService.startRecording()`)
5. Audio chunks piped to AssemblyAI via WebSocket (16kHz mono PCM16)
6. Partial transcripts displayed live in UI
7. User stops → AssemblyAI returns formatted final transcript
8. Final transcript sent to backend via `ConversationService.sendExchange()`
9. Backend response displayed, auto-restart recording for next turn
10. User taps "End" → `ConversationService.endConversation()` → Backend triggers memory extraction

### Key Services

**AuthenticationService** (`Services/AuthenticationService.swift`):
- Device-ID-based JWT authentication
- Device ID generated on first launch, stored in Keychain
- Access/refresh tokens stored in Keychain
- Auto-refreshes tokens on 401 responses
- Checks onboarding status via `/api/auth/me`

**ConversationService** (`Services/ConversationService.swift`):
- RESTful API client for conversation CRUD
- `createConversation()`: POST /api/conversations
- `sendExchange()`: POST /api/conversations/:id/exchange (user message → AI response)
- `endConversation()`: POST /api/conversations/:id/end (triggers backend memory extraction)
- `fetchConversations()`: GET /api/conversations (for archive view)

**AssemblyAIService** (`Services/AssemblyAIService.swift`):
- **v3 WebSocket API** (streaming real-time STT)
- Connection: `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true`
- Events: `Begin` (session start) → `Turn` (partial/final transcripts) → `Termination` (session end)
- **Formatted transcripts**: `format_turns=true` enables punctuation/capitalization on final transcripts
- **Multi-sentence accumulation**: Multiple formatted finals during one recording session are accumulated into single final transcript
- Control messages: `ForceEndpoint` (flush pending transcript), `Terminate` (close session)

**AudioRecordingService** (`Services/AudioRecordingService.swift`):
- Actor-isolated microphone capture via AVFoundation
- Captures native input format, converts to 16kHz mono PCM16 for AssemblyAI
- Cross-platform (iOS + macOS) permission handling
- Configures AVAudioSession on iOS (playAndRecord mode, Bluetooth support)
- Streams audio chunks to callback (processed by AssemblyAI)

**DeviceIDManager** (`Services/DeviceIDManager.swift`):
- Generates UUID on first launch
- Stores in Keychain (`com.cosmo.saturn.deviceID`)
- Persistent across app reinstalls (Keychain survives uninstall on iOS)

### Onboarding Flow

New users go through:
1. **WelcomeView**: Brand introduction
2. **PreIntroductionView**: Pre-onboarding context
3. **OnboardingConversationView**: Special conversational onboarding (uses `OnboardingConversationViewModel`)
4. On completion → `AuthenticationService.completeOnboarding()` → Backend marks `onboarding_completed = true`
5. Transition to `MainTabView` (Conversation + Archive tabs)

## API Response Convention

**snake_case JSON** (Backend sends snake_case, iOS maps to camelCase via `CodingKeys`):
```swift
struct User: Codable {
    let userId: String
    let createdAt: String
    let onboardingCompleted: Bool

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case createdAt = "created_at"
        case onboardingCompleted = "onboarding_completed"
    }
}
```

**All Codable structs** use `CodingKeys` enum to map snake_case JSON fields to camelCase Swift properties.

## Critical Context

### Device Authentication
- **No username/password**: Authentication is device-based (deviceId → JWT)
- Device ID stored in Keychain, survives app reinstalls
- Access token (short-lived) + refresh token (long-lived) stored in Keychain
- All protected API requests require `Authorization: Bearer <access_token>` header

### AssemblyAI v3 Streaming
- **WebSocket-based**: Not HTTP polling, maintains persistent connection during recording
- **format_turns=true**: Critical for getting punctuated/capitalized final transcripts
- **Accumulation strategy**: Multiple sentences in one recording session → accumulated into single final transcript
- **Control flow**: `ForceEndpoint` → Wait for formatted final (1.5s timeout) → `Terminate` → Close socket

### Audio Pipeline
- Native input format (varies by device) → Convert to 16kHz mono PCM16 → Stream to AssemblyAI
- Conversion happens in `AudioRecordingService.convertToAssemblyAIFormat()`
- Buffer size: 1024 frames (configurable via `installTap`)

### Conversation State Management
- `conversationId` persists across multiple turns in one session
- `turnNumber` increments with each user-assistant exchange
- Auto-restart recording after each assistant response (conversational flow, not transactional)
- "End" button terminates conversation, resets local state

### Entitlements (Saturn.entitlements)
Required capabilities:
- `com.apple.security.app-sandbox`: Sandboxed app
- `com.apple.security.device.audio-input`: Microphone access
- `com.apple.security.network.client`: Outbound network (backend API + AssemblyAI)
- `keychain-access-groups`: Keychain access for device ID + tokens

## Common Patterns

### Adding a New API Endpoint
1. Add response models in `Services/ConversationService.swift` (with `CodingKeys` for snake_case mapping)
2. Add method to `ConversationService` (use `AuthenticationService.shared.getAccessToken()` for auth)
3. Call from ViewModel (wrap in `Task` if async)
4. Update ViewModel `@Published` properties to trigger UI updates

### Error Handling
- Services throw errors (AuthError, ConversationError, STTError, AudioError)
- ViewModels catch errors, set `@Published var errorMessage: String?`
- Views display `.alert()` bound to `errorMessage != nil`

### Cross-Platform Support (iOS + macOS)
- Use `#if os(iOS)` / `#else` for platform-specific code
- AVAudioSession (iOS only) vs AVAudioEngine (cross-platform)
- Permission checks: `AVAudioSession.sharedInstance().recordPermission` (iOS) vs `AVCaptureDevice.authorizationStatus(for: .audio)` (macOS)

### Keychain Storage Pattern
```swift
// Save
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.cosmo.saturn.auth",
    kSecAttrAccount as String: "accessToken",
    kSecValueData as String: data,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
]
SecItemAdd(query as CFDictionary, nil)

// Retrieve
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.cosmo.saturn.auth",
    kSecAttrAccount as String: "accessToken",
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne
]
var item: CFTypeRef?
SecItemCopyMatching(query as CFDictionary, &item)
```

## Notes

- **Swift Concurrency**: All async/await code uses modern Swift concurrency (no completion handlers)
- **Actor Isolation**: `AudioRecordingService` is an `actor` for thread-safe audio buffer processing
- **@MainActor**: ViewModels use `@MainActor` to ensure UI updates on main thread
- **API Base URL Resolution**: Environment variable → Info.plist → Hardcoded fallback (localhost:3001 for Debug)
- **DerivedData**: Ignored in `.gitignore` (Xcode build artifacts)
- **No CocoaPods/SPM**: All dependencies are manual integrations or system frameworks

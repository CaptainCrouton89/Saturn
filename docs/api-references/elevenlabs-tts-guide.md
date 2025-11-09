# ElevenLabs TTS Reference

## Non-obvious Implementation Details

### Request Stitching for Consistent Audio
Use `previousRequestIds` with `.withRawResponse()` to maintain prosody across chunks:
```typescript
const response = await elevenlabs.textToSpeech.convert(voiceId, {
  text: paragraph,
  previousRequestIds: requestIds, // maintains style continuity
}).withRawResponse();

// Extract request ID from headers for next chunk
requestIds.push(response.rawResponse.headers.get("request-id") ?? "");
```

### Streaming Latency Optimization
`optimizeStreamingLatency`: 0-4 scale (higher = lower latency, not quality)
```typescript
const audioStream = await elevenlabs.textToSpeech.stream(voiceId, {
  optimizeStreamingLatency: 3, // 0-4
  modelId: "eleven_flash_v2_5" // lowest latency model
});
```

### Model Selection Gotchas
- `eleven_flash_v2_5`: Ultra-low latency (use for realtime)
- `eleven_turbo_v2_5`: Balanced speed/quality
- `eleven_multilingual_v2`: Highest quality, 29 languages
- Token cost varies by model (check `tokenCostFactor`)

### Speech-to-Speech Preserves Emotion
Unlike TTS, speech-to-speech maintains timing and emotional inflection:
```typescript
const converted = await elevenlabs.speechToSpeech.convert(targetVoiceId, {
  audio: fs.createReadStream("./original.mp3"),
  removeBackgroundNoise: true // optional cleanup
});
```

### Pronunciation Dictionaries Are Versioned
```typescript
pronunciationDictionaryLocators: [{
  pronunciationDictionaryId: dictionary.id,
  versionId: "latest" // can pin to specific version
}]
```

### Voice Settings Precedence
Voice-level settings can be overridden per-request:
```typescript
// Global voice settings (persisted)
await elevenlabs.voices.settings.update(voiceId, {
  stability: 0.6,
  similarityBoost: 0.85
});

// Per-request override (not persisted)
await elevenlabs.textToSpeech.convert(voiceId, {
  voiceSettings: { stability: 0.8 } // overrides global
});
```

### Text-to-Dialogue for Multi-Voice
Single API call for conversations (avoids stitching):
```typescript
await elevenlabs.textToDialogue.convert({
  dialogue: [
    { voiceId: "voice1", text: "Hello" },
    { voiceId: "voice2", text: "Hi there" }
  ]
});
```

### Audio Isolation vs Speech-to-Speech
- `audioIsolation`: Removes background noise, keeps same voice
- `speechToSpeech`: Converts to different voice, can remove noise

### Professional Voice Cloning Requires Labels
```typescript
await elevenlabs.voices.pvc.add({
  files: [stream1, stream2],
  labels: { // required for better quality
    accent: "american",
    age: "young",
    gender: "male"
  }
});
```

# AssemblyAI Realtime STT Reference

## Non-obvious Implementation Details

### Realtime Streaming Event Order
Events fire in specific sequence:
1. `Begin` - connection established, get session ID
2. `Turn` - partial/final transcripts
3. `Termination` - graceful close with audio duration
4. `Error` - failures

```python
from assemblyai.streaming.v3 import StreamingClient, StreamingEvents

client.on(StreamingEvents.Begin, on_begin)
client.on(StreamingEvents.Turn, on_turn)
client.on(StreamingEvents.Termination, on_terminated)
client.on(StreamingEvents.Error, on_error)
```

### Streaming Only Supports WAV/PCM16 Single-Channel
File streaming limitation:
```python
file_stream = aai.extras.stream_file(
  filepath="audio.wav",  # MUST be WAV/PCM16 single-channel
  sample_rate=44_100,
)
```

### Custom Spellings vs Pronunciation
`set_custom_spelling` maps alternate text forms (not phonetic):
```python
config.set_custom_spelling({
  "Kubernetes": ["k8s"],  # text variants, not IPA
  "SQL": ["Sequel"]
})
```

### Content Safety Has Confidence Threshold
Filter low-confidence labels:
```python
config = aai.TranscriptionConfig(
  content_safety=True,
  content_safety_confidence=80  # only labels >80%
)
```

### Speaker Labels Enable Sentiment-per-Speaker
```python
config = aai.TranscriptionConfig(
  sentiment_analysis=True,
  speaker_labels=True  # enables sentiment_result.speaker
)
```

### PII Redaction Audio vs Text
`redact_pii_audio` generates separate redacted audio file:
```python
transcript = transcriber.transcribe(url, config=aai.TranscriptionConfig(
  redact_pii=True,
  redact_pii_policies=[aai.PIIRedactionPolicy.person_name],
  redact_pii_audio=True  # separate audio output
))

redacted_url = transcript.get_redacted_audio_url()
transcript.save_redacted_audio("redacted.mp3")
```

### LeMUR Input Customization
Use `input_text` for formatted context instead of raw transcript:
```python
text = ""
for utt in transcript.utterances:
    text += f"Speaker {utt.speaker}:\n{utt.text}\n"

result = aai.Lemur().task(prompt, input_text=text)  # custom format
```

### Transcriber Config vs Per-Request Config
```python
# Default config for all operations
transcriber = aai.Transcriber(config=default_config)

# Override for specific request
transcriber.transcribe(url, config=override_config)
```

### Polling Interval is Global Setting
```python
aai.settings.polling_interval = 1.0  # affects all transcriptions
```

### TranscriptGroup for Multi-File LeMUR
Apply LeMUR across multiple transcripts:
```python
transcript_group = transcriber.transcribe_group([
  "url1.mp3",
  "url2.mp3"
])

summary = transcript_group.lemur.summarize(
  context="context for all files",
  answer_format="TLDR"
)
```

### LeMUR Request Data Deletion
```python
result = transcript_group.lemur.summarize(...)
request_id = result.request_id

# Delete sensitive LeMUR data
aai.Lemur.purge_request_data(request_id)
```

### List Transcripts Pagination Pattern
```python
params = aai.ListTranscriptParameters()
page = transcriber.list_transcripts(params)

while page.page_details.before_id_of_prev_url is not None:
    params.before_id = page.page_details.before_id_of_prev_url
    page = transcriber.list_transcripts(params)
```

### IAB Categories vs Auto Highlights
- `iab_categories`: Topic classification with industry-standard labels
- `auto_highlights`: Important phrases with relevance rank

### Export Subtitles Require No Config
Subtitles generated from any transcript:
```python
vtt = transcript.export_subtitles_vtt()
srt = transcript.export_subtitles_srt()
```

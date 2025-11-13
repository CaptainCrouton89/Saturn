# Source Node Schema

**Source** is a first-class episodic memory node that combines conversations, emails, Slack messages, meetings, and other raw source material. Unlike semantic nodes (Person, Concept, Entity), Sources can be shared across team members while maintaining full processing pipeline tracking.

## Core Fields

### Identity & Scope
- **entity_key**: string (UUID - stable identifier)
- **user_id**: string (who contributed this source - always set)
- **team_id**: string | null (set for team sources, null for personal)

### Content & Processing
- **raw_content**: json - **Original unprocessed data** stored in flexible structure (varies by source_type)
- **content**: {type: conversation | email | slack-thread | meeting | text-note | etc, content: string | json} - **Processed/refined content** (cleaned, structured)

### Source Classification

Three fields describe the source's nature, each serving a different purpose:

1. **source_type**: Technical ingestion origin (where the data came from)
   - Values: "voice-memo", "email", "slack-thread", "meeting", "text-import"
   - Immutable after creation
   - Used for pipeline routing and format handling

2. **content.type**: Normalized representation after processing
   - Values: "conversation", "email", "slack-thread", "meeting", "text-note"
   - Often matches source_type, but can differ if formats are unified
   - Example: source_type="voice-memo" → content.type="conversation" (both are conversational)

3. **context_type**: Human-purpose label (what the interaction was for)
   - Controlled vocabulary: "work-session", "team-meeting", "phone-call", "personal-reflection", "planning", "brainstorming", "email-thread", "slack-discussion"
   - NOT freeform - ingestion layer maps raw events to this predefined set
   - Used for contextual retrieval and semantic grouping
   - Can be updated if the purpose is better understood later

### Metadata
- **provenance**: json - metadata about origin (e.g., {origin: "assemblyai", confidence: 0.95, channel_id: "..."})
- **started_at**: ISO timestamp (when source began - for point-in-time sources like emails, same as created_at)
- **ended_at**: ISO timestamp | null (when source ended - NULL for point-in-time sources or ongoing)

### Participants & Access
- **participants**: [string] (array of user_ids involved - for personal sources, single user; for team sources, multiple users)

### Extracted Content
- **summary**: string (1-2 sentence summary generated during processing phase)
- **keywords**: [string] (searchable keywords extracted from content - key terms, topics, names)
- **tags**: [string] (unstructured metadata tags - useful for filtering, not quite keywords but searchable context)
- **embedding**: vector - built from summary

### Processing Status
- **processing_status**: enum (raw | processed | extracted) - tracks pipeline progress
- **processing_started_at**: ISO timestamp | null
- **processing_completed_at**: ISO timestamp | null
- **extraction_started_at**: ISO timestamp | null
- **extraction_completed_at**: ISO timestamp | null

### Memory Management
- **salience**: float (0-1) - graph centrality, boosted on access, decays over time
- **last_accessed_at**: ISO timestamp
- **access_count**: int
- **recall_frequency**: int (number of times retrieved, for spacing effect calculation)
- **last_recall_interval**: int (days between last two recalls)
- **decay_gradient**: float (default 1.0, increases with spacing effect for slower forgetting)
- **state**: enum (candidate | active | core | archived)

### Governance
- **sensitivity**: enum (low | normal | high) - governance flag for permissions/access control (default: normal, does NOT affect decay)
- **ttl_policy**: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay)

### Timestamps
- **created_at**: ISO timestamp
- **updated_at**: ISO timestamp

## Raw Content Structure

Content varies by source_type:

### Conversation
```json
{
  "type": "conversation",
  "content": "<JSONL transcript>"
}
```

### Email
```json
{
  "type": "email",
  "from": "...",
  "subject": "...",
  "body": "...",
  "headers": {...}
}
```

### Slack
```json
{
  "type": "slack-thread",
  "channel": "...",
  "messages": [...]
}
```

### Text
```json
{
  "type": "text-note",
  "content": "..."
}
```

## Field Semantics Summary

| Field | Meaning | Example (team meeting) | Example (personal voice memo) |
|-------|---------|------------------------|-------------------------------|
| `user_id` | Who created/contributed this Source | `"alice-123"` (Alice recorded) | `"alice-123"` (Alice recorded) |
| `participants` | All user_ids involved in the experience | `["alice-123", "bob-456", "charlie-789"]` | `["alice-123"]` |
| `team_id` | Which team context this Source belongs to | `"team-001"` (team context) | `null` (personal) |

## Key Invariants

- `user_id` is always present (never null)
- `user_id IN participants` (creator must be participant)
- `team_id = null` → personal Source
- `team_id != null` → team Source

## user_id vs participants Detailed Semantics

The distinction between `user_id` and `participants` enables proper access control and attribution:

### user_id: Always the creator/contributor of the Source
- For voice memos: The person who recorded
- For emails: The person who sent or imported it
- For meetings: The person who initiated or recorded
- For Slack threads: The person who initiated or imported
- **Always present** (never null)
- **Always included in participants** array

### participants: All user_ids involved in the experience
- For personal sources: `[user_id]` (single participant)
- For team meetings: `[user1, user2, user3, ...]` (all attendees)
- For email threads: All senders/receivers in the thread
- For Slack discussions: All users who contributed
- **Invariant**: `user_id IN participants` (creator must be participant)

## Access Control Pattern

```cypher
// Users can access Sources where they are participants OR it's their team
MATCH (s:Source)
WHERE s.user_id = $userId                // Created by them
  OR $userId IN s.participants           // They participated
  OR s.team_id IN $userTeamIds           // Team-scoped and they're members
RETURN s
```

## Examples

### Personal voice memo
- `user_id: "alice-123"` (Alice recorded it)
- `participants: ["alice-123"]` (only Alice)
- `team_id: null` (personal)

### Team meeting
- `user_id: "alice-123"` (Alice initiated/recorded)
- `participants: ["alice-123", "bob-456", "charlie-789"]` (all attendees)
- `team_id: "team-001"` (team context)

### Imported email thread
- `user_id: "alice-123"` (Alice imported it)
- `participants: ["alice-123", "bob-456"]` (sender + receivers)
- `team_id: "team-001"` (team email account)

## Processing Pipeline Integration

Source nodes track their progress through the ingestion pipeline:

1. **Raw** → Source created with raw_content, processing_status = "raw"
2. **Processed** → content field populated with cleaned/structured data, processing_status = "processed"
3. **Extracted** → Entity mentions identified, relationships created, processing_status = "extracted"

Processing timestamps track:
- `processing_started_at` / `processing_completed_at` - Overall content processing
- `extraction_started_at` / `extraction_completed_at` - Entity/relationship extraction phase

## Memory Consolidation

Sources represent episodic memories that can be consolidated into semantic knowledge:
- High-salience Sources are prioritized for entity extraction
- Frequently accessed Sources get boosted salience
- Over time, rich semantic information gets extracted into Person/Concept/Entity nodes
- Sources can be archived when their semantic content is consolidated and no longer actively needed

## Team Collaboration

Multiple users can share a Source while building individual semantic interpretations:
- Each user extracts their own Person/Concept/Entity nodes from shared Sources
- Authorship is tracked at Source level (user_id) and at relationship level
- Each user maintains personal perspectives derived from shared episodic experiences
- Access control ensures users only see Sources they created or participated in

# Artifact Node

## Overview

Artifact nodes represent user-generated outputs from conversations (actions, files, summaries, notes). They are always personal (user-scoped) and capture the user's interpretations and work products derived from semantic knowledge or episodic sources.

**Key Characteristic**: Artifacts are fundamentally personal work products, even if generated from shared team Sources.

## Schema

### Core Properties

- **entity_key**: string (UUID - stable identifier)
  - Immutable stable identifier for relationships
  - Used for entity resolution and linking

- **user_id**: string (who created this artifact)
  - Always set - identifies which user this Artifact belongs to
  - User-scoped like all semantic nodes
  - Determines access control

- **name**: string
  - Short human label for the artifact
  - Examples: "YC – competitors draft v2", "Meeting notes Jan 15"
  - Searchable identifier

- **description**: string
  - 1 sentence overview
  - Captures essential purpose/content

- **content**: object
  - `type`: enum (action | md_file | etc)
  - `output`: text | json
  - Stores the actual artifact content or metadata

- **sensitivity**: enum (low | normal | high)
  - Governance flag for permissions/access control
  - Default: normal
  - Does NOT affect decay behavior

- **ttl_policy**: enum (keep_forever | decay | ephemeral)
  - Governance: retention policy
  - Precedence order: keep_forever > ephemeral > decay
  - Determines how long artifact is retained

### Timestamp Properties

- **created_at**: ISO timestamp
  - When the artifact was generated

- **updated_at**: ISO timestamp
  - When the artifact was last modified

## Artifact Scoping Rules

### Always Personal (No team_id)

Artifacts are fundamentally user-scoped and do NOT include a `team_id` field, even if generated from team Sources:

- Artifacts are user-generated outputs (actions, files, summaries) tied to individual users
- Even if generated from team Sources, Artifacts belong to the user who created them
- Rationale: Artifacts represent personal work products and interpretations, not shared episodic experiences

### Access Control

- Artifacts are only accessible to their creator (`user_id`)
- Permission checks MUST verify artifact creator matches authenticated user
- No sharing or team-level artifact access in current design

### Example

Alice generates a summary from a team meeting Source:
- `user_id: "alice-123"` (Alice created it)
- No `team_id` field
- Only Alice can access this artifact
- Bob (another team member) cannot access Alice's summary artifact, even though they both attended the same Source (meeting)

## Creation Rules

### When to Create Artifacts

1. **Explicit conversation outputs**: Actions decided during conversation, meeting notes captured
2. **Generated summaries**: AI-generated summaries of meetings, conversations, or topics
3. **File outputs**: Markdown notes, todo lists, documents created during conversation
4. **Structured outputs**: JSON exports, structured analyses

### When NOT to Create Artifacts

- Temporary working notes during agent reasoning
- Failed attempts or drafts
- System-generated metadata or logs
- Duplicate artifacts from the same source/conversation

## Relationships

**Artifact nodes typically relate to**:

- `(Artifact)-[:sourced_from]->(Source)` - Relationship to original source (conversation, meeting, etc.)
  - Tracks provenance
  - Properties: creation_phase (int), extraction_date (ISO timestamp)

- `(Artifact)-[:relates_to]->(Person|Concept|Entity)` - Related semantic knowledge
  - Links artifacts to the entities they reference
  - Properties: relevance (float 0-1), notes (string)

## Content Storage

The `content` field is flexible to support different artifact types:

### Action Artifact

```json
{
  "type": "action",
  "output": "text",
  "details": "Follow up with Sarah about Q4 planning meeting"
}
```

### Markdown File

```json
{
  "type": "md_file",
  "output": "text",
  "filename": "meeting_notes_jan_15.md",
  "content": "# Meeting Notes\n\n- Discussed Q1 roadmap..."
}
```

### Structured Data

```json
{
  "type": "structured_summary",
  "output": "json",
  "data": {
    "key_topics": ["AI safety", "compute scaling"],
    "action_items": ["Research new models", "Schedule followup"],
    "sentiment": "positive"
  }
}
```

## Implementation Notes

- Always generate `entity_key` as UUID for new artifacts
- Validate `user_id` matches authenticated user before creation/retrieval
- Set `sensitivity` to `normal` by default (specify only if governance override needed)
- Set `ttl_policy` to `decay` by default (artifacts should fade unless explicitly retained)
- Use `created_at` and `updated_at` timestamps for temporal ordering
- Ensure `content.type` is one of: action, md_file, structured_summary, email_draft, etc.

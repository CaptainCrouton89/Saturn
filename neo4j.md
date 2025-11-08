Neo4j Schema

Core Node Types

// The user
(:User {
id: string,
name: string,
created_at: datetime,
// Question preference tracking (multi-armed bandit)
question_preferences: {
  probe: float,      // 0-1, how well probe questions work
  reflect: float,    // 0-1, how well reflection questions work
  reframe: float,    // 0-1, how well reframing questions work
  contrast: float,   // 0-1, how well contrast questions work
  hypothetical: float // 0-1, how well hypothetical questions work
}
})

// Lightweight conversation reference (links to PostgreSQL)
(:Conversation {
id: string,  // FK to your PostgreSQL conversation.id
summary: string,  // ~100 words: topics discussed, people mentioned, key decisions, emotional tone
date: datetime,
duration: int,  // minutes
trigger_method: string,
status: string,
topic_tags: [string]  // quick retrieval
})

// People mentioned in conversations
(:Person {
id: string,
entity_key: string,  // Stable ID: hash(lower(name) + type + user_id) for idempotency
name: string,
canonical_name: string,  // Normalized version for matching
relationship_type: string,  // friend, colleague, romantic_interest, family
first_mentioned_at: datetime,
last_mentioned_at: datetime,
updated_at: datetime,
// Provenance tracking
last_update_source: string,  // conversation_id where last updated
confidence: float,  // 0-1, confidence in entity resolution
excerpt_span: string,  // "turns 5-7" or "0:45-1:23" - where mentioned in source
// Rich context fields
how_they_met: string,
why_they_matter: string,
personality_traits: [string],  // MAX 10 items - most recent/salient
relationship_status: string,  // "growing", "stable", "fading", "complicated"
communication_cadence: string,  // "daily texts", "monthly calls", "sporadic"
current_life_situation: string,  // "just moved to NYC", "going through breakup"
// No embedding - search by name variants instead
})

// Projects user is thinking about
(:Project {
id: string,
entity_key: string,  // Stable ID for idempotency
name: string,
canonical_name: string,
status: string,  // active, paused, completed, abandoned
domain: string,  // startup, personal, creative, technical
first_mentioned_at: datetime,
last_mentioned_at: datetime,
// Provenance tracking
last_update_source: string,
confidence: float,
excerpt_span: string,
// Rich context fields
vision: string,  // Core purpose/problem it solves
blockers: [string],  // MAX 8 items - current obstacles
key_decisions: [string],  // MAX 10 items - important choices
confidence_level: float,  // 0-1, belief it will succeed
excitement_level: float,  // 0-1, emotional investment (independent from confidence)
time_invested: string, // Freeform estimation
money_invested: float,
embedding: vector  // Embedding of name + vision
})

// Topics of discussion
(:Topic {
id: string,
entity_key: string,
name: string,
canonical_name: string,
description: string,  // Brief description for context
category: string,  // technical, personal, philosophical, professional
first_mentioned_at: datetime,
last_mentioned_at: datetime,
// Provenance tracking
last_update_source: string,
confidence: float,
excerpt_span: string,
embedding: vector  // Embedding of name + description for semantic search
})

// Ideas that emerge from conversations
(:Idea {
id: string,
entity_key: string,
summary: string,
status: string,  // raw, refined, abandoned, implemented
created_at: datetime,
refined_at: datetime,
updated_at: datetime,
// Provenance tracking
last_update_source: string,
confidence: float,
excerpt_span: string,
// Rich context fields
original_inspiration: string,  // What sparked this
evolution_notes: string,  // How it's changed over time
obstacles: [string],  // MAX 8 items
resources_needed: [string],  // MAX 10 items
experiments_tried: [string],  // MAX 10 items
confidence_level: float,  // 0-1, belief it will work
excitement_level: float,  // 0-1, emotional pull (independent from confidence)
potential_impact: string,  // "could change my career" vs "fun side thing"
next_steps: [string],  // MAX 8 items
context_notes: string,  // Freeform details, connections, realizations
embedding: vector  // Embedding of summary + context_notes for semantic search
})

// Behavioral/thought patterns detected over time
// NOTE: Pattern detection not in MVP - schema reserved for future use
(:Pattern {
id: string,
entity_key: string,
description: string,
type: string,  // behavioral, thought, emotional, social
confidence_score: float,  // 0-1, increases with evidence
first_observed_at: datetime,
evidence_count: int,
// Provenance tracking
last_update_source: string
})

// User's stated values
// NOTE: Not actively used in MVP - schema reserved for future use
(:Value {
id: string,
entity_key: string,
description: string,
first_stated_at: datetime,
importance: string,  // core, secondary, aspirational
// Provenance tracking
last_update_source: string
})


// Artifacts created from conversations
(:Artifact {
id: string,
type: string,  // blog_post, plan, technical_doc, decision_framework
title: string,
created_at: datetime,
storage_location: string  // path or URL
})

// Supporting context nodes

// Alias tracking for entity resolution
(:Alias {
name: string,  // The alias/variant name
normalized_name: string,  // Lowercase, diacritics removed
type: string  // Person, Project, Topic, etc.
})

// Flexible notes for unstructured observations
(:Note {
id: string,
content: string,  // Freeform text
created_at: datetime,
updated_at: datetime,
tags: [string],  // MAX 15 items ["important", "funny", "insight", "painful", "tension", "breakthrough"]
sentiment: float,  // -1 to 1
embedding: vector  // For semantic search across all notes
})

Relationship Types

// User relationships
(User)-[:HAD_CONVERSATION {timestamp: datetime}]->(Conversation)
(User)-[:KNOWS {relationship_quality: float, last_mentioned_at:
datetime}]->(Person)
(User)-[:WORKING_ON {status: string, priority: int, last_discussed_at:
datetime}]->(Project)
(User)-[:INTERESTED_IN {engagement_level: float, last_discussed_at:
datetime, frequency: int}]->(Topic)
(User)-[:VALUES {strength: float}]->(Value)  // Not in MVP
(User)-[:HAS_PATTERN {confirmed_at: datetime}]->(Pattern)  // Not in MVP

// Conversation content relationships
(Conversation)-[:MENTIONED {count: int, sentiment: float, 
importance_score: float}]->(Person|Project|Topic|Idea)
(Conversation)-[:DISCUSSED {depth: string}]->(Topic)  // surface,
moderate, deep
(Conversation)-[:EXPLORED {outcome: string}]->(Idea)  // refined,
abandoned, implemented
(Conversation)-[:REVEALED {confidence: float}]->(Pattern)
(Conversation)-[:PRODUCED]->(Artifact)
(Conversation)-[:FOLLOWED_UP {time_gap_hours: int, continuation_type:
string}]->(Conversation)

// Entity relationships
(Person)-[:RELATED_TO {relationship_description: string}]->(Person)
(Person)-[:INVOLVED_IN {role: string}]->(Project)
(Person)-[:ASSOCIATED_WITH]->(Topic)
(Person)-[:SHARED_EXPERIENCE {description: string, date: datetime}]->(Person)
(Person)-[:TENSION_WITH {description: string, severity: float}]->(Person)
(Project)-[:RELATED_TO]->(Topic)
(Project)-[:INSPIRED_BY]->(Person|Idea|Project)
(Project)-[:BLOCKED_BY {description: string}]->(Person|Project|Idea)
(Idea)-[:RELATED_TO]->(Project|Topic)
(Idea)-[:EVOLVED_INTO {evolution_description: string}]->(Idea)
(Idea)-[:MERGED_WITH]->(Idea)
(Pattern)-[:CONTRADICTS {contradiction_description: string, severity:
float}]->(Value)  // Not in MVP
(Pattern)-[:MANIFESTS_IN]->(Topic|Person|Project)  // Not in MVP
(User)-[:FEELS {emotion: string, intensity: float, noted_at: datetime}]->(Person|Project|Idea)

// Alias relationships for entity resolution
(Alias)-[:ALIAS_OF]->(Person|Project|Topic)

// Supporting node attachments
(Person|Project|Idea|Topic|Conversation)-[:HAS_NOTE]->(Note)

---
Key Design Decisions

1. Conversation Node is Lightweight

The Neo4j Conversation node only has summary (~100 words) + metadata. Full transcript
stays in PostgreSQL. This keeps graph queries fast while enabling deep
relationship traversal.

2. Bidirectional Sync

- After each conversation: Extract entities → create/update Neo4j nodes
- Before each conversation: Query graph for context ("what's active?",
"what's unresolved?")

3. Entity Resolution with Stable IDs & Aliases

All entities use `entity_key` (hash of normalized name + type + user_id) for
idempotency across batch runs. Alias nodes track name variants for accurate
matching:
- "Sarah", "Sarah J", "SJ" → same Person via ALIAS_OF
- Prevents entity duplication across conversations
- Supports confident entity resolution using canonical_name matching

4. Provenance & Confidence Tracking

All entities track `last_update_source`, `confidence`, and `excerpt_span` to
support debugging and quality monitoring:
- Which conversation last updated this entity?
- How confident was the resolution? (0.7 = low, 0.95 = high)
- Where in the conversation was this mentioned?

5. Bounded Arrays Prevent Bloat

All array properties have MAX limits (8-15 items) to prevent unbounded growth:
- Prefer counters on relationships over per-conversation duplication
- Keep most recent/salient items when array is full
- Move long histories to separate Note nodes via HAS_NOTE

6. Question Preference Learning

User node tracks `question_preferences` (probe, reflect, reframe, contrast,
hypothetical) to power adaptive conversation style using multi-armed bandit
approach. Track which question types lead to engagement and adjust accordingly.

---
Powerful Queries This Enables

1. What should we talk about? (Conversation DJ)

// Find topics that:
// - User is highly engaged with
// - Haven't been discussed recently
// - Have unresolved threads
MATCH (u:User)-[r:INTERESTED_IN]->(t:Topic)
WHERE r.last_discussed_at < datetime() - duration('P7D')
AND r.engagement_level > 0.7
OPTIONAL MATCH (t)<-[:DISCUSSED]-(recent:Conversation)
WHERE recent.date > datetime() - duration('P30D')
WITH t, r, count(recent) as recent_mentions
WHERE recent_mentions < 3
RETURN t.name, r.engagement_level, r.last_discussed_at
ORDER BY r.engagement_level DESC
LIMIT 5

2. What's currently active?

// Recent mentions across conversations
MATCH
(u:User)-[:HAD_CONVERSATION]->(c:Conversation)-[m:MENTIONED]->(entity)
WHERE c.date > datetime() - duration('P7D')
WITH entity, count(m) as mentions, sum(m.importance_score) as
total_importance
RETURN labels(entity)[0] as entity_type,
        entity.name,
        mentions,
        total_importance
ORDER BY total_importance DESC
LIMIT 10

3. Build context for new conversation

// Get rich context: active topics, recent people, unresolved ideas
MATCH (u:User)-[:HAD_CONVERSATION]->(recent:Conversation)
WHERE recent.date > datetime() - duration('P14D')
WITH u, collect(recent) as recent_convos

// Active topics
OPTIONAL MATCH
(u)-[:INTERESTED_IN]->(t:Topic)<-[:DISCUSSED]-(recent_convos)
WITH u, recent_convos, collect(DISTINCT t) as active_topics

// Recent people
OPTIONAL MATCH (u)-[:KNOWS]->(p:Person)<-[:MENTIONED]-(recent_convos)
WITH u, recent_convos, active_topics, collect(DISTINCT p) as 
recent_people

// Unresolved ideas
OPTIONAL MATCH
(u)-[:HAD_CONVERSATION]->(:Conversation)-[:EXPLORED]->(idea:Idea)
WHERE idea.status = 'raw'
WITH u, active_topics, recent_people, collect(idea) as unresolved_ideas

RETURN {
active_topics: [t IN active_topics | t.name],
recent_people: [p IN recent_people | p.name],
unresolved_ideas: [i IN unresolved_ideas | i.summary]
}

4. Resolve entity by name or alias

// Find existing entity by name or alias
MATCH (a:Alias {normalized_name: toLower($mentionedName)})-[:ALIAS_OF]->(entity)
RETURN entity
UNION
MATCH (entity {canonical_name: toLower($mentionedName)})
RETURN entity

---
Future Work (Not MVP)

1. Pre-computed conversation starters
   - Nightly batch job computes top conversation topics/people/projects
   - Store in User.conversation_starters for instant retrieval
   - Eliminates latency from complex live queries

2. Concurrent update locking
   - Lock entities during live conversations
   - Prevent batch jobs from updating same entities simultaneously
   - Use optimistic locking or row-level locks

3. Pattern & contradiction detection
   - Weekly job analyzing across all recent conversations
   - Detect behavioral patterns, contradictions between Values and Patterns
   - Create/update CONTRADICTS edges with severity scores
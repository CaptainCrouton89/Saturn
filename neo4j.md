Neo4j Schema

Core Node Types

// The user
(:User {
id: string,
name: string,
created_at: datetime
})

// Lightweight conversation reference (links to PostgreSQL)
(:Conversation {
id: string,  // FK to your PostgreSQL conversation.id
summary: string,
date: datetime,
duration: int,  // minutes
trigger_method: string,
status: string,
topic_tags: [string]  // quick retrieval
})

// People mentioned in conversations
(:Person {
id: string,
name: string,
relationship_type: string,  // friend, colleague, romantic_interest, family
first_mentioned_at: datetime,
last_mentioned_at: datetime,
updated_at: datetime,
// Rich context fields
how_they_met: string,
why_they_matter: string,
personality_traits: [string],  // ["thoughtful", "intense", "avoidant"]
relationship_status: string,  // "growing", "stable", "fading", "complicated"
communication_cadence: string,  // "daily texts", "monthly calls", "sporadic"
current_life_situation: string,  // "just moved to NYC", "going through breakup"
// No embedding - search by name variants instead
})

// Projects user is thinking about
(:Project {
id: string,
name: string,
status: string,  // active, paused, completed, abandoned
domain: string,  // startup, personal, creative, technical
first_mentioned_at: datetime,
last_mentioned_at: datetime,
// Rich context fields
vision: string,  // Core purpose/problem it solves
blockers: [string],  // Current obstacles
key_decisions: [string],  // Important technical/strategic choices made
confidence_level: float,  // 0-1, belief it will succeed
excitement_level: float,  // 0-1, emotional investment (independent from confidence)
time_invested: string, // Freeform estimation
money_invested: float,
embedding: vector  // Embedding of name + vision
})

// Topics of discussion
(:Topic {
id: string,
name: string,
description: string,  // Brief description for context
category: string,  // technical, personal, philosophical, professional
first_mentioned_at: datetime,
last_mentioned_at: datetime,
embedding: vector  // Embedding of name + description for semantic search
})

// Ideas that emerge from conversations
(:Idea {
id: string,
summary: string,
status: string,  // raw, refined, abandoned, implemented
created_at: datetime,
refined_at: datetime,
updated_at: datetime,
// Rich context fields
original_inspiration: string,  // What sparked this
evolution_notes: string,  // How it's changed over time
obstacles: [string],  // What's blocking it
resources_needed: [string],  // What you'd need to implement
experiments_tried: [string],  // Tests or explorations done
confidence_level: float,  // 0-1, belief it will work
excitement_level: float,  // 0-1, emotional pull (independent from confidence)
potential_impact: string,  // "could change my career" vs "fun side thing"
next_steps: [string],
context_notes: string,  // Freeform details, connections, realizations
embedding: vector  // Embedding of summary + context_notes for semantic search
})

// Behavioral/thought patterns detected over time
(:Pattern {
id: string,
description: string,
type: string,  // behavioral, thought, emotional, social
confidence_score: float,  // 0-1, increases with evidence
first_observed_at: datetime,
evidence_count: int
})

// User's stated values
(:Value {
id: string,
description: string,
first_stated_at: datetime,
importance: string  // core, secondary, aspirational
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

// Flexible notes for unstructured observations
(:Note {
id: string,
content: string,  // Freeform text
created_at: datetime,
updated_at: datetime,
tags: [string],  // ["important", "funny", "insight", "painful", "tension", "breakthrough"]
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
(User)-[:VALUES {strength: float}]->(Value)
(User)-[:HAS_PATTERN {confirmed_at: datetime}]->(Pattern)

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
float}]->(Value)
(Pattern)-[:MANIFESTS_IN]->(Topic|Person|Project)
(User)-[:FEELS {emotion: string, intensity: float, noted_at: datetime}]->(Person|Project|Idea)

// Supporting node attachments
(Person|Project|Idea|Topic|Conversation)-[:HAS_NOTE]->(Note)

---
Key Design Decisions

1. Conversation Node is Lightweight

The Neo4j Conversation node only has summary + metadata. Full transcript
stays in PostgreSQL. This keeps graph queries fast while enabling deep
relationship traversal.

2. Bidirectional Sync

- After each conversation: Extract entities → create/update Neo4j nodes
- Before each conversation: Query graph for context ("what's active?",
"what's unresolved?")

3. Pattern Detection Engine

The Pattern and Value nodes with CONTRADICTS relationships enable the
core insight from your vision:

"You keep saying you want someone independent, but every person you're
excited about is super available. What's that about?"

This happens by tracking:
- Stated values (Value nodes)
- Observed patterns (Pattern nodes)
- Contradictions (CONTRADICTS relationships)

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

2. Spot contradictions (Core insight feature)

MATCH (u:User)-[:HAS_PATTERN]->(p:Pattern)-[c:CONTRADICTS]->(v:Value)
WHERE p.confidence_score > 0.6
RETURN p.description as behavior,
        v.description as stated_value,
        c.contradiction_description,
        c.severity
ORDER BY c.severity DESC

3. What's currently active?

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

4. Find conversation threads

// Get full thread from a conversation
MATCH path=(start:Conversation)-[:FOLLOWED_UP*0..]->(end:Conversation)
WHERE start.id = $conversation_id
WITH path, end
ORDER BY end.date DESC
RETURN path
LIMIT 1

5. Build context for new conversation

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

Key Design Decisions

1. Conversation Node is Lightweight

The Neo4j Conversation node only has summary + metadata. Full transcript
stays in PostgreSQL. This keeps graph queries fast while enabling deep
relationship traversal.

2. Bidirectional Sync

- After each conversation: Extract entities → create/update Neo4j nodes
- Before each conversation: Query graph for context ("what's active?",
"what's unresolved?")

3. Pattern Detection Engine

The Pattern and Value nodes with CONTRADICTS relationships enable the
core insight from your vision:

"You keep saying you want someone independent, but every person you're
excited about is super available. What's that about?"

This happens by tracking:
- Stated values (Value nodes)
- Observed patterns (Pattern nodes)
- Contradictions (CONTRADICTS relationships)

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

2. Spot contradictions (Core insight feature)

MATCH (u:User)-[:HAS_PATTERN]->(p:Pattern)-[c:CONTRADICTS]->(v:Value)
WHERE p.confidence_score > 0.6
RETURN p.description as behavior,
        v.description as stated_value,
        c.contradiction_description,
        c.severity
ORDER BY c.severity DESC

3. What's currently active?

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

4. Find conversation threads

// Get full thread from a conversation
MATCH path=(start:Conversation)-[:FOLLOWED_UP*0..]->(end:Conversation)
WHERE start.id = $conversation_id
WITH path, end
ORDER BY end.date DESC
RETURN path
LIMIT 1

5. Build context for new conversation

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
/**
 * Neo4j Graph Entity Types
 * Based on schema defined in neo4j.md
 */

// ============================================================================
// Core Node Types
// ============================================================================

export interface Concept {
  id: string;
  entity_key: string; // Stable ID: hash(normalized name + 'concept' + user_id)
  user_id: string;
  name: string;
  description: string; // 1 sentence overview
  notes: string;
  updated_at: Date;
  created_at: Date;
  // Provenance tracking
  last_update_source: string;
  confidence: number; // 0-1
  embedding?: number[]; // Vector embedding built from description + notes
}

export interface Entity {
  id: string;
  entity_key: string; // Stable ID: hash(normalized name + type + user_id)
  user_id: string;
  name: string;
  type: string; // company, place, object, group, institution, product, technology, etc.
  description: string; // 1 sentence overview
  notes: string;
  updated_at: Date;
  created_at: Date;
  // Provenance tracking
  last_update_source: string;
  confidence: number; // 0-1
  embedding?: number[]; // Vector embedding built from description + notes
}

export interface Source {
  id: string;
  entity_key: string; // Stable ID: hash(description + user_id + created_at)
  user_id: string;
  content: {
    type: string; // transcript, etc.
    content: string; // text or json
  };
  description: string; // 1 sentence
  updated_at: Date;
  created_at: Date;
  // Source classification
  source_type?: string; // voice-memo, email, slack-thread, meeting, text-import
  // Extracted content
  summary?: string; // 1-2 sentence summary
  keywords?: string[]; // searchable keywords
  tags?: string[]; // metadata tags
  embedding?: number[]; // Vector embedding built from summary
  // Processing status
  processing_status?: string; // raw | processed | extracted
  processing_started_at?: Date;
  processing_completed_at?: Date;
  extraction_started_at?: Date;
  extraction_completed_at?: Date;
  // Memory management
  salience?: number; // 0-1
  state?: string; // candidate | active | core | archived
  access_count?: number;
  recall_frequency?: number;
  last_accessed_at?: Date;
  last_recall_interval?: number;
  decay_gradient?: number;
  // Governance
  sensitivity?: string; // low | normal | high
  ttl_policy?: string; // keep_forever | decay | ephemeral
  // Provenance tracking
  last_update_source?: string;
}

export interface Person {
  id: string;
  entity_key: string; // Stable ID: hash(lower(name) + type + user_id) for idempotency
  user_id: string; // User who owns this entity (required for all nodes)
  team_id?: string | null; // Team context (null for personal nodes, set for team-scoped nodes)
  name: string;
  canonical_name: string; // Normalized version for matching
  is_owner?: boolean; // Optional - only set to true for the Person node representing the user themselves
  updated_at: Date;
  created_at: Date;
  // Provenance tracking
  last_update_source: string; // conversation_id where last updated
  confidence: number; // 0-1, confidence in entity resolution
  // Rich context fields (from tech.md schema)
  appearance?: string; // Physical description
  situation?: string; // Current life circumstances, what they're going through
  history?: string; // Background, how you know them, past context
  personality?: string; // Traits, communication style, quirks
  expertise?: string; // What they're good at, professional domain
  interests?: string; // Hobbies, passions, topics they care about
  notes?: string; // Other relevant information
}

// NOTE: Pattern detection not in MVP - schema reserved for future use
export interface Pattern {
  id: string;
  entity_key: string;
  description: string;
  type: 'behavioral' | 'thought' | 'emotional' | 'social';
  confidence_score: number; // 0-1
  first_observed_at: Date;
  evidence_count: number;
  // Provenance tracking
  last_update_source: string;
}

// NOTE: Not actively used in MVP - schema reserved for future use
export interface Value {
  id: string;
  entity_key: string;
  description: string;
  first_stated_at: Date;
  importance: 'core' | 'secondary' | 'aspirational';
  // Provenance tracking
  last_update_source: string;
}

export interface Artifact {
  id: string;
  entity_key: string; // Stable ID: hash(description + user_id + created_at)
  user_id: string;
  content: {
    type: string; // action, md_file, image, etc.
    output: string | Record<string, unknown>; // text or json
  };
  description: string; // 1 sentence
  notes?: string; // Unstructured information
  updated_at: Date;
  created_at: Date;
}

export interface Note {
  id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
  tags?: string[]; // MAX 15 items: "important", "funny", "insight", "painful", "tension", "breakthrough"
  sentiment?: number; // -1 to 1
  embedding?: number[]; // Vector embedding
}

// Alias tracking for entity resolution
export interface Alias {
  name: string; // The alias/variant name
  normalized_name: string; // Lowercase, diacritics removed
  type: string; // Person, Project, Topic, etc.
}

// ============================================================================
// Relationship Types
// ============================================================================

export interface RelationshipProperties {
  // User relationships
  HAD_CONVERSATION?: {
    timestamp: Date;
  };
  KNOWS?: {
    relationship_type: string; // friend, colleague, romantic_interest, family
    relationship_quality: number; // float
    how_they_met?: string;
    why_they_matter?: string;
    relationship_status?: string; // growing, stable, fading, complicated
    communication_cadence?: string; // daily texts, monthly calls, sporadic
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  };
  WORKING_ON?: {
    status: string; // active, paused, completed, abandoned
    priority: number;
    last_discussed_at: Date;
    confidence_level?: number; // belief it will succeed
    excitement_level?: number; // emotional investment
    time_invested?: string; // freeform estimation
    money_invested?: number;
    blockers?: string[]; // MAX 8 items - current obstacles
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  };
  INTERESTED_IN?: {
    engagement_level: number; // float
    last_discussed_at: Date;
    frequency: number;
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  };
  EXPLORING?: {
    status: string; // raw, refined, abandoned, implemented
    confidence_level?: number; // belief it will work
    excitement_level?: number; // emotional pull
    potential_impact?: string; // "could change my career" vs "fun side thing"
    next_steps?: string[]; // MAX 8 items
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  };
  VALUES?: {
    strength: number; // float
  };
  HAS_PATTERN?: {
    confirmed_at: Date;
  };

  // Conversation content relationships
  MENTIONED?: {
    mentions: Array<{
      conversation_id: string;
      timestamp: Date;
    }>; // MAX 20 items - timeline of when entity was mentioned
  };
  DISCUSSED?: {
    discussions: Array<{
      conversation_id: string;
      timestamp: Date;
    }>; // MAX 20 items - timeline of when topic was discussed
  };
  EXPLORED?: {
    explorations: Array<{
      conversation_id: string;
      timestamp: Date;
    }>; // MAX 20 items - timeline of when idea was explored
  };
  REVEALED?: {
    confidence: number; // float
  };
  FOLLOWED_UP?: {
    time_gap_hours: number;
    continuation_type: string;
  };

  // Entity relationships
  RELATED_TO?: {
    relationship_description?: string;
  };
  INVOLVED_IN?: {
    role: string;
  };
  SHARED_EXPERIENCE?: {
    description: string;
    date: Date;
  };
  TENSION_WITH?: {
    description: string;
    severity: number; // float
  };
  INSPIRED_BY?: Record<string, never>; // no properties
  BLOCKED_BY?: {
    description: string;
  };
  EVOLVED_INTO?: {
    evolution_description: string;
  };
  CONTRADICTS?: {
    contradiction_description: string;
    severity: number; // float
  };
  MANIFESTS_IN?: Record<string, never>; // no properties
  FEELS?: {
    emotion: string;
    intensity: number; // float
    noted_at: Date;
  };

  // Entity relationships (from tech.md)
  RELATES_TO_ENTITY?: {
    relationship_type: string; // owns, part_of, near, competes_with, etc.
    notes: string;
    relevance: number; // 1-10
    created_at: Date;
    updated_at: Date;
  };
  RELATES_TO_PERSON?: {
    relationship_type: string; // work, life, other, etc.
    notes: string;
    relevance: number; // 1-10
    created_at: Date;
    updated_at: Date;
  };
  INVOLVES_ENTITY?: {
    notes: string;
    relevance: number; // 1-10
    created_at: Date;
    updated_at: Date;
  };
}

// ============================================================================
// Query Result Types
// ============================================================================

export interface ConversationContext {
  active_topics: string[];
  recent_people: string[];
  unresolved_ideas: string[];
}

export interface EntityActivity {
  entity_type: string;
  name: string;
  mentions: number;
  total_importance: number;
}

export interface Contradiction {
  behavior: string;
  stated_value: string;
  contradiction_description: string;
  severity: number;
}

export interface ConversationSuggestion {
  topic_name: string;
  engagement_level: number;
  last_discussed_at: Date;
}

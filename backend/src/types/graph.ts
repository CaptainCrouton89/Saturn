/**
 * Neo4j Graph Entity Types
 * Based on schema defined in neo4j.md
 */

// ============================================================================
// Core Node Types
// ============================================================================

export interface User {
  id: string;
  name: string;
  created_at: Date;
  // Question preference tracking (multi-armed bandit)
  question_preferences?: {
    probe: number; // 0-1, how well probe questions work
    reflect: number; // 0-1, how well reflection questions work
    reframe: number; // 0-1, how well reframing questions work
    contrast: number; // 0-1, how well contrast questions work
    hypothetical: number; // 0-1, how well hypothetical questions work
  };
}

export interface Conversation {
  id: string; // FK to PostgreSQL conversation.id
  summary: string; // ~100 words: topics discussed, people mentioned, key decisions, emotional tone
  date: Date;
  duration: number; // minutes
  trigger_method: string;
  status: string;
  topic_tags: string[];
}

export interface Person {
  id: string;
  entity_key: string; // Stable ID: hash(lower(name) + type + user_id) for idempotency
  name: string;
  canonical_name: string; // Normalized version for matching
  relationship_type: 'friend' | 'colleague' | 'romantic_interest' | 'family' | string;
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  updated_at: Date;
  // Provenance tracking
  last_update_source: string; // conversation_id where last updated
  confidence: number; // 0-1, confidence in entity resolution
  excerpt_span: string; // "turns 5-7" or "0:45-1:23" - where mentioned in source
  // Rich context fields
  how_they_met?: string;
  why_they_matter?: string;
  personality_traits?: string[]; // MAX 10 items - most recent/salient
  relationship_status?: 'growing' | 'stable' | 'fading' | 'complicated' | string;
  communication_cadence?: string;
  current_life_situation?: string;
}

export interface Project {
  id: string;
  entity_key: string; // Stable ID for idempotency
  name: string;
  canonical_name: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  domain: 'startup' | 'personal' | 'creative' | 'technical' | string;
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  // Provenance tracking
  last_update_source: string;
  confidence: number;
  excerpt_span: string;
  // Rich context fields
  vision?: string;
  blockers?: string[]; // MAX 8 items - current obstacles
  key_decisions?: string[]; // MAX 10 items - important choices
  confidence_level?: number; // 0-1
  excitement_level?: number; // 0-1
  time_invested?: string;
  money_invested?: number;
  embedding?: number[]; // Vector embedding
}

export interface Topic {
  id: string;
  entity_key: string;
  name: string;
  canonical_name: string;
  description: string;
  category: 'technical' | 'personal' | 'philosophical' | 'professional' | string;
  first_mentioned_at: Date;
  last_mentioned_at: Date;
  // Provenance tracking
  last_update_source: string;
  confidence: number;
  excerpt_span: string;
  embedding?: number[]; // Vector embedding
}

export interface Idea {
  id: string;
  entity_key: string;
  summary: string;
  status: 'raw' | 'refined' | 'abandoned' | 'implemented';
  created_at: Date;
  refined_at?: Date;
  updated_at: Date;
  // Provenance tracking
  last_update_source: string;
  confidence: number;
  excerpt_span: string;
  // Rich context fields
  original_inspiration?: string;
  evolution_notes?: string;
  obstacles?: string[]; // MAX 8 items
  resources_needed?: string[]; // MAX 10 items
  experiments_tried?: string[]; // MAX 10 items
  confidence_level?: number; // 0-1
  excitement_level?: number; // 0-1
  potential_impact?: string;
  next_steps?: string[]; // MAX 8 items
  context_notes?: string;
  embedding?: number[]; // Vector embedding
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
  type: 'blog_post' | 'plan' | 'technical_doc' | 'decision_framework' | string;
  title: string;
  created_at: Date;
  storage_location: string; // path or URL
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
    relationship_quality: number; // float
    last_mentioned_at: Date;
  };
  WORKING_ON?: {
    status: string;
    priority: number;
    last_discussed_at: Date;
  };
  INTERESTED_IN?: {
    engagement_level: number; // float
    last_discussed_at: Date;
    frequency: number;
  };
  VALUES?: {
    strength: number; // float
  };
  HAS_PATTERN?: {
    confirmed_at: Date;
  };

  // Conversation content relationships
  MENTIONED?: {
    count: number;
    sentiment: number; // float
    importance_score: number; // float
  };
  DISCUSSED?: {
    depth: 'surface' | 'moderate' | 'deep';
  };
  EXPLORED?: {
    outcome: 'refined' | 'abandoned' | 'implemented';
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

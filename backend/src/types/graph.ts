/**
 * Neo4j Graph Entity Types
 * Based on schema defined in neo4j.md
 */

// ============================================================================
// Entity Type Definition
// ============================================================================

import { NodeLabels, RelationshipTypes } from '../constants/graph.js';

// ============================================================================
// Entity Type Definition
// ============================================================================

/**
 * Canonical entity type representation (lowercase)
 * Used throughout the codebase for type consistency
 */
export type EntityType = Lowercase<typeof NodeLabels.Person | typeof NodeLabels.Concept | typeof NodeLabels.Entity>;

// ============================================================================
// Core Node Types
// ============================================================================

// Note object structure used across entity types
export interface NoteObject {
  content: string;
  added_by: string;
  date_added: string; // ISO timestamp
  source_entity_key: string | null;
  expires_at: string | null; // ISO timestamp
}

/**
 * Canonical type for semantic neighbor nodes
 *
 * Represents neighboring semantic nodes (Person, Concept, Entity) with:
 * - Core node identification (entity_key, name, type)
 * - Similarity/relevance score (from embedding search or contextual proximity)
 * - Optional enrichment (description, notes)
 *
 * Used throughout ingestion pipeline and context loading for consistent neighbor representation.
 */
export interface SemanticNeighbor {
  entity_key: string;
  name: string;
  entity_type: EntityType;
  similarity_score: number;
  description?: string | null;
  notes?: NoteObject[];
}

export interface Concept {
  id: string;
  entity_key: string; // Stable ID: hash(normalized name + 'concept' + user_id)
  user_id: string;
  created_by: string; // User who created this node (required for audit trail)
  name: string;
  description: string; // 1 sentence overview
  notes?: NoteObject[];
  is_dirty?: boolean; // Flags for refresh when notes added
  updated_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  // Provenance tracking
  last_update_source: string;
  confidence: number; // 0-1
  embedding?: number[]; // Vector embedding built from description + notes
  // Memory management
  salience?: number; // 0-1
  state?: 'candidate' | 'active' | 'core' | 'archived';
  access_count?: number;
  recall_frequency?: number;
  last_recall_interval?: number;
  decay_gradient?: number;
  last_accessed_at?: string; // ISO timestamp
  ttl_policy?: 'keep_forever' | 'decay' | 'ephemeral';
  // Hierarchical memory counters
  source_count?: number; // Number of Sources mentioning this concept
  first_mentioned_at?: string; // ISO timestamp // First Source mention timestamp
  distinct_source_days?: number; // Number of distinct calendar days with mentions
  distinct_days?: string[]; // Array of ISO dates for deduplication
  has_meso?: boolean; // True when Storyline created for this anchor
  has_macro?: boolean; // True when Macro created for this anchor
}

export interface Entity {
  id: string;
  entity_key: string; // Stable ID: hash(normalized name + user_id)
  user_id: string;
  created_by: string; // User who created this node (required for audit trail)
  name: string;
  description: string; // 1 sentence overview
  notes?: NoteObject[];
  is_dirty?: boolean; // Flags for refresh when notes added
  updated_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  // Provenance tracking
  last_update_source: string;
  confidence: number; // 0-1
  embedding?: number[]; // Vector embedding built from description + notes
  // Memory management
  salience?: number; // 0-1
  state?: 'candidate' | 'active' | 'core' | 'archived';
  access_count?: number;
  recall_frequency?: number;
  last_recall_interval?: number;
  decay_gradient?: number;
  last_accessed_at?: string; // ISO timestamp
  ttl_policy?: 'keep_forever' | 'decay' | 'ephemeral';
  // Hierarchical memory counters
  source_count?: number; // Number of Sources mentioning this entity
  first_mentioned_at?: string; // ISO timestamp // First Source mention timestamp
  distinct_source_days?: number; // Number of distinct calendar days with mentions
  distinct_days?: string[]; // Array of ISO dates for deduplication
  has_meso?: boolean; // True when Storyline created for this anchor
  has_macro?: boolean; // True when Macro created for this anchor
}

export interface Source {
  id: string;
  entity_key: string; // Stable ID: hash(description + user_id + created_at)
  source_id?: string; // External source identifier (e.g., dialogue-123-chunk-0) for idempotent lookups
  user_id: string;
  content: {
    type: string; // transcript, etc.
    content: string | Record<string, unknown>; // text or json
  };
  raw_content: string; // Original unprocessed RAW TEXT (not JSON, not stringified)
  description: string; // 1 sentence (required)
  participants: string[]; // User IDs of conversation participants (required)
  started_at: string; // ISO timestamp // When the conversation started (required)
  ended_at?: string | null; // ISO timestamp // When the conversation ended
  updated_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  // Source classification
  source_type?: string; // voice-memo, email, slack-thread, meeting, text-import
  team_id?: string | null; // Team context (null for personal, set for team-scoped)
  context_type?: string; // Additional context classification
  // Extracted content
  summary?: string; // 1-2 sentence summary
  keywords?: string[]; // searchable keywords
  tags?: string[]; // metadata tags
  embedding?: number[]; // Vector embedding built from summary
  // Processing status
  processing_status?: string; // raw | processed | extracted
  processing_started_at?: string; // ISO timestamp
  processing_completed_at?: string; // ISO timestamp
  extraction_started_at?: string; // ISO timestamp
  extraction_completed_at?: string; // ISO timestamp
  // Memory management
  salience?: number; // 0-1
  state?: string; // candidate | active | core | archived
  access_count?: number;
  recall_frequency?: number;
  last_accessed_at?: string; // ISO timestamp
  last_recall_interval?: number;
  decay_gradient?: number;
  // Governance
  sensitivity?: string; // low | normal | high
  ttl_policy?: string; // keep_forever | decay | ephemeral
  // Provenance tracking
  provenance?: Record<string, unknown>; // Provenance metadata
  last_update_source?: string;
}

export interface Person {
  id: string;
  entity_key: string; // Stable ID: hash(name.toLowerCase() + user_id) for idempotency
  user_id: string; // User who owns this entity (required for all nodes)
  created_by: string; // User who created this node (required for audit trail)
  name: string;
  is_owner?: boolean; // Optional - only set to true for the Person node representing the user themselves
  description?: string; // Short description of who this person is
  notes?: NoteObject[];
  is_dirty?: boolean; // Flags for refresh when notes added
  embedding?: number[]; // Vector embedding built from description + notes
  updated_at: string; // ISO timestamp
  created_at: string; // ISO timestamp
  // Provenance tracking
  last_update_source?: string; // conversation_id where last updated
  confidence?: number; // 0-1, confidence in entity resolution
  // Memory management
  salience?: number; // 0-1, graph centrality
  state?: string; // candidate | active | core | archived
  access_count?: number;
  recall_frequency?: number;
  last_accessed_at?: string; // ISO timestamp
  last_recall_interval?: number;
  decay_gradient?: number;
  ttl_policy?: string; // keep_forever | decay | ephemeral
  // Hierarchical memory counters
  source_count?: number; // Number of Sources mentioning this person
  first_mentioned_at?: string; // ISO timestamp // First Source mention timestamp
  distinct_source_days?: number; // Number of distinct calendar days with mentions
  distinct_days?: string[]; // Array of ISO dates for deduplication
  has_meso?: boolean; // True when Storyline created for this anchor
  has_macro?: boolean; // True when Macro created for this anchor
}

// NOTE: Pattern detection not in MVP - schema reserved for future use
export interface Pattern {
  id: string;
  entity_key: string;
  description: string;
  type: 'behavioral' | 'thought' | 'emotional' | 'social';
  confidence_score: number; // 0-1
  first_observed_at: string; // ISO timestamp
  evidence_count: number;
  // Provenance tracking
  last_update_source: string;
}

// NOTE: Not actively used in MVP - schema reserved for future use
export interface Value {
  id: string;
  entity_key: string;
  description: string;
  first_stated_at: string; // ISO timestamp
  importance: 'core' | 'secondary' | 'aspirational';
  // Provenance tracking
  last_update_source: string;
}

export interface Artifact {
  id: string;
  entity_key: string; // Stable ID: hash(description + user_id + created_at)
  user_id: string;
  name?: string; // Short human label (optional, defaults to null)
  description: string; // 1 sentence
  content: {
    type: string; // action, md_file, structured_summary, etc.
    output: string | Record<string, unknown>; // text or json
  };
  sensitivity?: 'low' | 'normal' | 'high'; // Governance: permissions/access (default: normal)
  ttl_policy?: 'keep_forever' | 'decay' | 'ephemeral'; // Governance: retention (default: decay)
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface Note {
  id: string;
  content: string;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  tags?: string[]; // MAX 15 items: "important", "funny", "insight", "painful", "tension", "breakthrough"
  sentiment?: number; // -1 to 1
  embedding?: number[]; // Vector embedding
}

export interface Storyline {
  storyline_id: string;
  user_id: string;
  team_id: string | null;
  anchor_entity_key: string;
  name: string;
  description: string;
  embedding?: number[];
  is_dirty?: boolean;
  source_count?: number;
  started_at?: string; // ISO timestamp
  last_source_at?: string; // ISO timestamp
  salience?: number;
  state?: 'candidate' | 'active' | 'core' | 'archived';
  ttl_policy?: 'keep_forever' | 'decay' | 'ephemeral';
  access_count?: number;
  recall_frequency?: number;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface Macro {
  macro_id: string;
  user_id: string;
  team_id: string | null;
  anchor_entity_key: string;
  name: string;
  description: string;
  embedding?: number[];
  is_dirty?: boolean;
  storyline_count?: number;
  total_source_count?: number;
  started_at?: string; // ISO timestamp
  last_event_at?: string; // ISO timestamp
  salience?: number;
  state?: string;
  ttl_policy?: string;
  access_count?: number;
  recall_frequency?: number;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  last_accessed_at?: string; // ISO timestamp
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
  [RelationshipTypes.HadConversation]?: {
    timestamp: string; // ISO timestamp
  };
  [RelationshipTypes.Knows]?: {
    relationship_type: string; // friend, colleague, romantic_interest, family
    relationship_quality: number; // float
    how_they_met?: string;
    why_they_matter?: string;
    relationship_status?: string; // growing, stable, fading, complicated
    communication_cadence?: string; // daily texts, monthly calls, sporadic
    first_mentioned_at: string; // ISO timestamp
    last_mentioned_at: string; // ISO timestamp
  };
  [RelationshipTypes.WorkingOn]?: {
    status: string; // active, paused, completed, abandoned
    priority: number;
    last_discussed_at: string; // ISO timestamp
    confidence_level?: number; // belief it will succeed
    excitement_level?: number; // emotional investment
    time_invested?: string; // freeform estimation
    money_invested?: number;
    blockers?: string[]; // MAX 8 items - current obstacles
    first_mentioned_at: string; // ISO timestamp
    last_mentioned_at: string; // ISO timestamp
  };
  [RelationshipTypes.InterestedIn]?: {
    engagement_level: number; // float
    last_discussed_at: string; // ISO timestamp
    frequency: number;
    first_mentioned_at: string; // ISO timestamp
    last_mentioned_at: string; // ISO timestamp
  };
  [RelationshipTypes.Exploring]?: {
    status: string; // raw, refined, abandoned, implemented
    confidence_level?: number; // belief it will work
    excitement_level?: number; // emotional pull
    potential_impact?: string; // "could change my career" vs "fun side thing"
    next_steps?: string[]; // MAX 8 items
    first_mentioned_at: string; // ISO timestamp
    last_mentioned_at: string; // ISO timestamp
  };
  [RelationshipTypes.Values]?: {
    strength: number; // float
  };
  [RelationshipTypes.HasPattern]?: {
    confirmed_at: string; // ISO timestamp
  };

  // Conversation content relationships
  [RelationshipTypes.Mentioned]?: {
    mentions: Array<{
      conversation_id: string;
      timestamp: string; // ISO timestamp
    }>; // MAX 20 items - timeline of when entity was mentioned
  };
  [RelationshipTypes.Discussed]?: {
    discussions: Array<{
      conversation_id: string;
      timestamp: string; // ISO timestamp
    }>; // MAX 20 items - timeline of when topic was discussed
  };
  [RelationshipTypes.Explored]?: {
    explorations: Array<{
      conversation_id: string;
      timestamp: string; // ISO timestamp
    }>; // MAX 20 items - timeline of when idea was explored
  };
  [RelationshipTypes.Revealed]?: {
    confidence: number; // float
  };
  [RelationshipTypes.FollowedUp]?: {
    time_gap_hours: number;
    continuation_type: string;
  };

  // Entity relationships
  [RelationshipTypes.RelatedTo]?: {
    relationship_description?: string;
  };
  [RelationshipTypes.InvolvedIn]?: {
    role: string;
  };
  [RelationshipTypes.SharedExperience]?: {
    description: string;
    date: string; // ISO timestamp
  };
  [RelationshipTypes.TensionWith]?: {
    description: string;
    severity: number; // float
  };
  [RelationshipTypes.InspiredBy]?: Record<string, never>; // no properties
  [RelationshipTypes.BlockedBy]?: {
    description: string;
  };
  [RelationshipTypes.EvolvedInto]?: {
    evolution_description: string;
  };
  [RelationshipTypes.Contradicts]?: {
    contradiction_description: string;
    severity: number; // float
  };
  [RelationshipTypes.ManifestsIn]?: Record<string, never>; // no properties
  [RelationshipTypes.Feels]?: {
    emotion: string;
    intensity: number; // float
    noted_at: string; // ISO timestamp
  };

  // Entity relationships (from tech.md)
  [RelationshipTypes.RelatesToEntity]?: {
    relationship_type: string; // owns, part_of, near, competes_with, etc.
    notes: string;
    relevance: number; // 1-10
    created_at: string; // ISO timestamp
    updated_at: string; // ISO timestamp
  };
  [RelationshipTypes.RelatesToPerson]?: {
    relationship_type: string; // work, life, other, etc.
    notes: string;
    relevance: number; // 1-10
    created_at: string; // ISO timestamp
    updated_at: string; // ISO timestamp
  };
  [RelationshipTypes.InvolvesEntity]?: {
    notes: string;
    relevance: number; // 1-10
    created_at: string; // ISO timestamp
    updated_at: string; // ISO timestamp
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
  last_discussed_at: string; // ISO timestamp
}

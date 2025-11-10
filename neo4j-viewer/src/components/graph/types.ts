// Node types matching Neo4j schema
export type NodeType = 'User' | 'Person' | 'Project' | 'Topic' | 'Idea' | 'Conversation' | 'Note' | 'Artifact';

// Graph node structure
export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  val?: number; // Node size (optional)
  x?: number; // Position x (set by force-graph)
  y?: number; // Position y (set by force-graph)
  // Type-specific properties
  details?: PersonDetails | ProjectDetails | TopicDetails | IdeaDetails | ConversationDetails;
}

// Type-specific detail interfaces
export interface PersonDetails {
  relationship_type: string;
  personality_traits: string[]; // MAX 10
  current_life_situation?: string;
  last_mentioned_at: string;
  first_mentioned_at: string;
  // Rich context fields from neo4j.md
  how_they_met?: string;
  why_they_matter?: string;
  relationship_status?: string; // "growing", "stable", "fading", "complicated"
  communication_cadence?: string; // "daily texts", "monthly calls", "sporadic"
  // Provenance
  confidence: number; // 0-1
  excerpt_span?: string; // "turns 5-7" or "0:45-1:23"
}

export interface ProjectDetails {
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  domain: string; // startup, personal, creative, technical
  vision: string;
  blockers: string[]; // MAX 8
  key_decisions: string[]; // MAX 10
  confidence_level: number; // 0-1
  excitement_level: number; // 0-1
  time_invested?: string; // Freeform estimation
  money_invested?: number;
  first_mentioned_at: string;
  last_mentioned_at: string;
  // Provenance
  confidence: number;
  excerpt_span?: string;
}

export interface TopicDetails {
  description: string;
  category: string; // technical, personal, philosophical, professional
  first_mentioned_at: string;
  last_mentioned_at: string;
  // Provenance
  confidence: number;
  excerpt_span?: string;
}

export interface IdeaDetails {
  summary: string;
  status: 'raw' | 'refined' | 'abandoned' | 'implemented';
  confidence_level: number; // 0-1
  excitement_level: number; // 0-1
  next_steps: string[]; // MAX 8
  // Rich context fields from neo4j.md
  original_inspiration?: string;
  evolution_notes?: string;
  obstacles: string[]; // MAX 8
  resources_needed: string[]; // MAX 10
  experiments_tried: string[]; // MAX 10
  potential_impact?: string; // "could change my career" vs "fun side thing"
  context_notes?: string;
  created_at: string;
  refined_at?: string;
  updated_at: string;
  // Provenance
  confidence: number;
  excerpt_span?: string;
}

export interface ConversationDetails {
  summary: string;
  date: string;
  duration: number; // minutes
  trigger_method?: string;
  status?: string;
  topic_tags: string[];
}

// Graph edge structure
export interface GraphLink {
  source: string; // Node ID
  target: string; // Node ID
  label?: string; // Relationship type (e.g., "KNOWS", "WORKING_ON")
  value?: number; // Link strength (optional)
  // Relationship properties (from Neo4j schema)
  properties?: RelationshipProperties;
}

// Relationship properties based on Neo4j schema
export type RelationshipProperties =
  | KnowsProperties
  | WorkingOnProperties
  | InterestedInProperties
  | MentionedProperties
  | DiscussedProperties
  | RelatedToProperties
  | InvolvedInProperties
  | FeelsProperties;

export interface KnowsProperties {
  relationship_quality: number; // 0-1
  last_mentioned_at: string;
}

export interface WorkingOnProperties {
  status: string;
  priority: number;
  last_discussed_at: string;
}

export interface InterestedInProperties {
  engagement_level: number; // 0-1
  last_discussed_at: string;
  frequency: number;
}

export interface MentionedProperties {
  count: number;
  sentiment: number; // -1 to 1
  importance_score: number; // 0-1
}

export interface DiscussedProperties {
  depth: string; // "surface", "moderate", "deep"
}

export interface RelatedToProperties {
  description?: string;
}

export interface InvolvedInProperties {
  role: string;
}

export interface FeelsProperties {
  emotion: string;
  intensity: number; // 0-1
  noted_at: string;
}

// Complete graph data structure
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

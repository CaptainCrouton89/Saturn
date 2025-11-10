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
  // Type-specific properties (intrinsic to the node)
  details?: PersonDetails | ProjectDetails | TopicDetails | IdeaDetails | ConversationDetails;
  // User's relationship to this node (if applicable)
  userRelationship?: KnowsProperties | WorkingOnProperties | InterestedInProperties | ExploringProperties;
}

// Type-specific detail interfaces
export interface PersonDetails {
  // Node properties (intrinsic to the person)
  personality_traits?: string[]; // MAX 10
  current_life_situation?: string;
  // Provenance
  confidence: number; // 0-1
  excerpt_span?: string; // "turns 5-7" or "0:45-1:23"
}

export interface ProjectDetails {
  // Node properties (intrinsic to the project)
  domain?: string; // startup, personal, creative, technical
  vision?: string;
  key_decisions?: string[]; // MAX 10
  // Provenance
  confidence: number;
  excerpt_span?: string;
}

export interface TopicDetails {
  // Node properties
  description?: string;
  category?: string; // technical, personal, philosophical, professional
  // Provenance
  confidence: number;
  excerpt_span?: string;
}

export interface IdeaDetails {
  // Node properties (intrinsic to the idea)
  summary: string;
  original_inspiration?: string;
  evolution_notes?: string;
  obstacles?: string[]; // MAX 8
  resources_needed?: string[]; // MAX 10
  experiments_tried?: string[]; // MAX 10
  context_notes?: string;
  created_at?: string;
  refined_at?: string;
  updated_at?: string;
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
  topic_tags?: string[];
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
  | ExploringProperties
  | MentionedProperties
  | DiscussedProperties
  | RelatedToProperties
  | InvolvedInProperties
  | FeelsProperties;

export interface KnowsProperties {
  // Relationship properties (user-specific)
  relationship_type: string;
  relationship_quality: number; // 0-1
  how_they_met?: string;
  why_they_matter?: string;
  relationship_status?: string; // "growing", "stable", "fading", "complicated"
  communication_cadence?: string; // "daily texts", "monthly calls", "sporadic"
  first_mentioned_at: string;
  last_mentioned_at: string;
}

export interface WorkingOnProperties {
  // Relationship properties (user-specific)
  status: string; // active, paused, completed, abandoned
  priority: number;
  last_discussed_at: string;
  first_mentioned_at: string;
  last_mentioned_at: string;
  confidence_level?: number; // 0-1, belief it will succeed
  excitement_level?: number; // 0-1, emotional investment
  time_invested?: string;
  money_invested?: number;
  blockers?: string[]; // MAX 8
}

export interface InterestedInProperties {
  // Relationship properties (user-specific)
  engagement_level: number; // 0-1
  last_discussed_at: string;
  first_mentioned_at: string;
  last_mentioned_at: string;
  frequency: number;
}

export interface ExploringProperties {
  // Relationship properties (user-specific)
  status: string; // raw, refined, abandoned, implemented
  first_mentioned_at: string;
  last_mentioned_at: string;
  confidence_level?: number; // 0-1, belief it will work
  excitement_level?: number; // 0-1, emotional pull
  potential_impact?: string;
  next_steps?: string[]; // MAX 8
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

// Node types matching Neo4j schema
export type NodeType = 'User' | 'Person' | 'Project' | 'Topic' | 'Idea' | 'Conversation';

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
  personality_traits: string[];
  current_life_situation?: string;
  last_mentioned_at: string;
}

export interface ProjectDetails {
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  vision: string;
  blockers: string[];
  confidence_level: number;
  excitement_level: number;
}

export interface TopicDetails {
  description: string;
  category: string;
  last_mentioned_at: string;
}

export interface IdeaDetails {
  summary: string;
  status: 'raw' | 'refined' | 'abandoned' | 'implemented';
  confidence_level: number;
  excitement_level: number;
  next_steps: string[];
}

export interface ConversationDetails {
  summary: string;
  date: string;
  duration: number;
  topic_tags: string[];
}

// Graph edge structure
export interface GraphLink {
  source: string; // Node ID
  target: string; // Node ID
  label?: string; // Relationship type (e.g., "KNOWS", "WORKING_ON")
  value?: number; // Link strength (optional)
}

// Complete graph data structure
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

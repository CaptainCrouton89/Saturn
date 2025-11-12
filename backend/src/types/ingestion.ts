/**
 * Ingestion System Type Definitions
 *
 * Core types for the agent-based ingestion pipeline that processes conversation
 * transcripts and updates the Neo4j knowledge graph.
 *
 * Based on tech.md specification (lines 228-265)
 */

// ============================================================================
// Entity Extraction Types
// ============================================================================

/**
 * Raw entity mention extracted from conversation transcript
 * This represents an entity as it appears in the conversation before resolution
 */
export interface EntityMention {
  /** The name/phrase as it appears in the transcript */
  mentioned_name: string;
  /** Type of entity: person, concept, entity */
  entity_type: 'person' | 'concept' | 'entity';
  /** For entities: company, place, object, group, institution, product, technology, etc. */
  entity_subtype?: string;
  /** User-specific context that makes this worth storing (required for concepts/entities) */
  context_clue: string;
}

/**
 * Entity after resolution/matching to existing graph nodes
 * Contains the stable entity_key and indicates whether this is new or existing
 */
export interface ResolvedEntity {
  /** Original name from transcript */
  mentioned_name: string;
  /** Type of entity */
  entity_type: 'person' | 'concept' | 'entity';
  /** For entities: specific subtype */
  entity_subtype?: string;
  /** Stable identifier (hash of normalized name + type + user_id) */
  entity_key: string;
  /** Neo4j node ID if matched to existing entity, null if new */
  matched_id: string | null;
  /** True if this entity doesn't exist in graph yet */
  is_new: boolean;
  /** User-specific context from the conversation */
  context_clue: string;
}

// ============================================================================
// Tool Input/Output Schemas
// ============================================================================

/**
 * Input schema for node creation/update tools
 * Used by the relationship agent to create/update Person, Concept, Entity nodes
 */
export interface NodeToolInput {
  /** For updates: entity_key of existing node. For creates: omit or null */
  entity_key?: string | null;
  /** Node properties - varies by node type */
  properties: PersonNodeProperties | ConceptNodeProperties | EntityNodeProperties;
}

/**
 * Properties for Person nodes (tech.md:15-30)
 */
export interface PersonNodeProperties {
  /** Required for creates: normalized canonical name */
  canonical_name?: string;
  /** Display name */
  name?: string;
  /** Physical description */
  appearance?: string;
  /** Current life circumstances, what they're going through */
  situation?: string;
  /** Background, how you know them, past context */
  history?: string;
  /** Traits, communication style, quirks */
  personality?: string;
  /** What they're good at, professional domain */
  expertise?: string;
  /** Hobbies, passions, topics they care about */
  interests?: string;
  /** Other relevant information that doesn't fit structured fields */
  notes?: string;
}

/**
 * Properties for Concept nodes (tech.md:5-13)
 */
export interface ConceptNodeProperties {
  /** Concept name */
  name?: string;
  /** 1 sentence overview of most important information */
  description?: string;
  /** Other relevant information that doesn't fit structured fields */
  notes?: string;
}

/**
 * Properties for Entity nodes (tech.md:31-40)
 */
export interface EntityNodeProperties {
  /** Entity name */
  name?: string;
  /** Entity type: company, place, object, group, institution, product, technology, etc. */
  type?: string;
  /** 1 sentence overview of most important information */
  description?: string;
  /** Other relevant information that doesn't fit structured fields */
  notes?: string;
}

/**
 * Input schema for relationship creation/update tools
 * Validates relationship type and ensures properties match allowed schema
 */
export interface RelationshipToolInput {
  /** entity_key of source node */
  from_entity_key: string;
  /** entity_key of target node */
  to_entity_key: string;
  /** Relationship type - must match one of the allowed types */
  relationship_type:
    | 'thinks_about'
    | 'has_relationship_with'
    | 'relates_to'
    | 'involves'
    | 'produced'
    | 'mentions'
    | 'sourced_from';
  /** Relationship properties - validated based on relationship_type */
  properties: RelationshipProperties;
}

/**
 * Union type for all possible relationship properties
 * Actual properties allowed depend on the relationship_type
 */
export type RelationshipProperties =
  | PersonThinksAboutConceptProperties
  | PersonHasRelationshipWithPersonProperties
  | ConceptRelatesToConceptProperties
  | ConceptInvolvesPersonProperties
  | ConceptInvolvesEntityProperties
  | ConceptProducedArtifactProperties
  | PersonRelatesToEntityProperties
  | EntityRelatesToEntityProperties;

/**
 * Person [thinks_about] Concept properties (tech.md:59-63)
 */
export interface PersonThinksAboutConceptProperties {
  /** Emotional stance: dreads, excited_by, loves, misses, wants, fears, etc. */
  mood?: string;
  /** How often they think about this (times per month) */
  frequency?: number;
}

/**
 * Person [has_relationship_with] Person properties (tech.md:65-71)
 */
export interface PersonHasRelationshipWithPersonProperties {
  /** Attitude: hostile, unfriendly, neutral, friendly, close, loving */
  attitude_towards_person?: string;
  /** How well they know each other: 1-5 (1=barely know, 5=very well) */
  closeness?: number;
  /** Type: colleague, employee, partner, sister, mother, spouse, roommate, boss, friend, etc. */
  relationship_type?: string;
  /** Rich text description of the relationship */
  notes?: string;
}

/**
 * Concept [relates_to] Concept properties (tech.md:73-77)
 */
export interface ConceptRelatesToConceptProperties {
  /** Rich text description of how they're related */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

/**
 * Concept [involves] Person properties (tech.md:79-83)
 */
export interface ConceptInvolvesPersonProperties {
  /** Rich text description of involvement */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

/**
 * Concept [involves] Entity properties (tech.md:85-89)
 */
export interface ConceptInvolvesEntityProperties {
  /** Rich text description of involvement */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

/**
 * Concept [produced] Artifact properties (tech.md:91-95)
 */
export interface ConceptProducedArtifactProperties {
  /** Rich text description of how concept produced artifact */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

/**
 * Person [relates_to] Entity properties (tech.md:97-102)
 */
export interface PersonRelatesToEntityProperties {
  /** Type of relationship: work, life, other, etc. */
  relationship_type?: string;
  /** Rich text description */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

/**
 * Entity [relates_to] Entity properties (tech.md:104-109)
 */
export interface EntityRelatesToEntityProperties {
  /** Type: owns, part_of, near, competes_with, etc. */
  relationship_type?: string;
  /** Rich text description */
  notes?: string;
  /** How closely related: 1-10 */
  relevance?: number;
}

// ============================================================================
// Retrieval Tool Schemas (tech.md:161-226)
// ============================================================================

/**
 * Input for explore tool - semantic + text-based graph exploration
 * Allows rapid investigation into the graph using embeddings and fuzzy matching
 */
export interface ExploreInput {
  /** Semantic search queries with similarity thresholds */
  queries?: Array<{
    /** Natural language query to embed and search */
    query: string;
    /** Minimum cosine similarity threshold (0-1) */
    threshold: number;
  }>;
  /** Exact/fuzzy text matches to search for in entity names */
  text_matches?: string[];
  /** If true, include match scores and features in response */
  return_explanations?: boolean;
}

/**
 * Output from explore tool - expanded graph with hits, edges, and neighbors
 */
export interface ExploreOutput {
  /** Top matching nodes (concepts, entities, persons, sources) */
  nodes: Array<{
    entity_key: string;
    type: 'person' | 'concept' | 'entity' | 'source';
    name?: string;
    description?: string;
    /** All properties for hit nodes */
    properties: Record<string, unknown>;
    /** Match score 0-1 (if return_explanations=true) */
    score?: number;
    /** Match type: embedding, text, fuzzy (if return_explanations=true) */
    match_type?: string;
  }>;
  /** Top edges between hits, or between hits and user, sorted by relevance/date */
  edges: Array<{
    from_entity_key: string;
    to_entity_key: string;
    relationship_type: string;
    /** All properties on the edge */
    properties: Record<string, unknown>;
    /** Relevance score or date for sorting */
    sort_key: number;
  }>;
  /** Neighbor nodes (1-hop from hits) - limited properties */
  neighbors: Array<{
    entity_key: string;
    type: 'person' | 'concept' | 'entity' | 'source';
    name?: string;
    description?: string;
  }>;
}

/**
 * Input for traverse tool - direct Cypher query execution
 * Allows agent to navigate the graph with custom queries
 */
export interface TraverseInput {
  /** Cypher query to execute */
  cypher: string;
  /** If false, truncate content fields (notes, description) in results */
  verbose: boolean;
}

/**
 * Output from traverse tool - structured query results
 */
export interface TraverseOutput {
  /** Query results as array of records */
  results: Array<Record<string, unknown>>;
  /** If verbose=false, indicates which fields were truncated */
  truncated_fields?: string[];
}

/**
 * Ingestion System Type Definitions
 *
 * Core types for the agent-based ingestion pipeline that processes conversation
 * transcripts and updates the Neo4j knowledge graph.
 *
 * Based on tech.md specification (lines 228-265)
 */

import type {
    ConceptInvolvesEntity,
    ConceptInvolvesPerson,
    ConceptNode,
    ConceptProducedArtifact,
    ConceptRelatesToConcept,
    EntityNode,
    EntityRelatesToEntity,
    ExploreInput,
    ExploreOutput,
    PersonHasRelationshipWithPerson,
    PersonNode,
    PersonRelatesToEntity,
    PersonThinksAboutConcept,
    TraverseInput,
    TraverseOutput,
} from '../agents/schemas/ingestion.js';
import { type EntityType } from './graph.js';

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
  entity_type: EntityType;
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
  entity_type: EntityType;
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
export type PersonNodeProperties = PersonNode;

/**
 * Properties for Concept nodes (tech.md:5-13)
 */
export type ConceptNodeProperties = ConceptNode;

/**
 * Properties for Entity nodes (tech.md:31-40)
 */
export type EntityNodeProperties = EntityNode;

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
    | 'engages_with'
    | 'has_relationship_with'
    | 'associated_with'
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
 * Person [engages_with] Concept properties (tech.md:59-63)
 */
export type PersonThinksAboutConceptProperties = PersonThinksAboutConcept;

/**
 * Person [has_relationship_with] Person properties (tech.md:65-71)
 */
export type PersonHasRelationshipWithPersonProperties = PersonHasRelationshipWithPerson;

/**
 * Concept [relates_to] Concept properties (tech.md:73-77)
 */
export type ConceptRelatesToConceptProperties = ConceptRelatesToConcept;

/**
 * Concept [involves] Person properties (tech.md:79-83)
 */
export type ConceptInvolvesPersonProperties = ConceptInvolvesPerson;

/**
 * Concept [involves] Entity properties (tech.md:85-89)
 */
export type ConceptInvolvesEntityProperties = ConceptInvolvesEntity;

/**
 * Concept [produced] Artifact properties (tech.md:91-95)
 */
export type ConceptProducedArtifactProperties = ConceptProducedArtifact;

/**
 * Person [associated_with] Entity properties (tech.md:97-102)
 */
export type PersonRelatesToEntityProperties = PersonRelatesToEntity;

/**
 * Entity [relates_to] Entity properties (tech.md:104-109)
 */
export type EntityRelatesToEntityProperties = EntityRelatesToEntity;

// ============================================================================
// Retrieval Tool Schemas (tech.md:161-226)
// ============================================================================

/**
 * Input for explore tool - semantic + text-based graph exploration
 * Allows rapid investigation into the graph using embeddings and fuzzy matching
 */
export type { ExploreInput };

/**
 * Output from explore tool - expanded graph with hits, edges, and neighbors
 */
    export type { ExploreOutput };

/**
 * Input for traverse tool - direct Cypher query execution
 * Allows agent to navigate the graph with custom queries
 */
    export type { TraverseInput };

/**
 * Output from traverse tool - structured query results
 */
    export type { TraverseOutput };

// ============================================================================
// Entity Resolution Types
// ============================================================================

/**
 * Extracted entity from Entity Extraction before resolution
 * Used as input to the entity resolution pipeline
 *
 * Phase 1: Embeddings are generated immediately after extraction (before resolution).
 * The embedding field should be set during extraction phase.
 */
export interface ExtractedEntity {
  /** Entity name as extracted */
  name: string;
  /** Entity type */
  entity_type: EntityType;
  /** Description/context from extraction */
  description: string;
  /** Detailed subpoints about the entity */
  subpoints?: string[];
  /** Extraction confidence (0-1) */
  confidence: number;
  /** Vector embedding for semantic similarity matching (generated during extraction phase) */
  embedding: number[];
}

/**
 * Result of entity resolution for a single entity
 */
export interface EntityResolutionResult {
  /** Whether the entity was matched to an existing node */
  resolved: boolean;
  /** entity_key if resolved=true */
  entity_key?: string;
  /** LLM explanation for resolution decision */
  resolution_reason: string;
  /** Candidate nodes considered (0-20) */
  candidates: Array<{
    entity_key: string;
    name: string;
    description: string | null;
    similarity_score?: number;
  }>;
}

/**
 * Resolved entity with embedding and resolution metadata
 * Combines extraction data with resolution results
 */
export interface ResolvedEntityWithMetadata extends ExtractedEntity {
  /** Embedding vector for the entity */
  embedding: number[];
  /** Whether matched to existing node */
  resolved: boolean;
  /** entity_key (either matched or newly created) */
  entity_key?: string;
  /** Resolution reason from LLM */
  resolution_reason: string;
  /** Candidates considered during resolution */
  candidates: EntityResolutionResult['candidates'];
}

/**
 * Neighbor node match from similarity search
 */
export interface NeighborMatch {
  entity_key: string;
  name: string;
  description: string | null;
  notes: string[];
  /** Cosine similarity score (0-1) */
  similarity_score: number;
}

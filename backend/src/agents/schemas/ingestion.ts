/**
 * Zod Validation Schemas for Ingestion Pipeline
 *
 * Defines strict validation schemas for all node types and relationships
 * based on the Neo4j graph schema in tech.md.
 *
 * These schemas are used by LangGraph agent tools to validate inputs
 * and ensure data integrity when creating/updating graph entities.
 */

import { z } from 'zod';

// ============================================================================
// Node Schemas (tech.md:5-40)
// ============================================================================

/**
 * Person node schema
 *
 * Represents people mentioned in conversations with rich contextual information.
 * The canonical_name is required for creates but cannot be updated.
 *
 * Properties (for create/update tools):
 * - canonical_name: Normalized name for entity resolution (required for create)
 * - name: Display name
 * - is_owner: Set to true ONLY for Person node representing the user themselves
 * - appearance: Physical description
 * - situation: Current life circumstances
 * - history: Background and context
 * - personality: Traits and quirks
 * - expertise: Professional domain
 * - interests: Hobbies and passions
 *
 * Notes: Use add_note_to_person tool to add notes (notes are arrays with metadata, not strings).
 * See backend/scripts/ingestion/nodes/person.md for complete property list.
 */
export const PersonNodeSchema = z.object({
  canonical_name: z.string().optional().describe('Normalized name for entity resolution'),
  name: z.string().optional().describe('Display name'),
  is_owner: z
    .boolean()
    .optional()
    .describe('Set to true ONLY for Person node representing the user themselves'),
  appearance: z.string().optional().describe('Physical description'),
  situation: z
    .string()
    .optional()
    .describe('Current life circumstances, what they are going through'),
  history: z.string().optional().describe('Background, how you know them, past context'),
  personality: z.string().optional().describe('Traits, communication style, quirks'),
  expertise: z.string().optional().describe('What they are good at, professional domain'),
  interests: z.string().optional().describe('Hobbies, passions, topics they care about'),
});

/**
 * Concept node schema
 *
 * Represents important concepts/topics/projects that have gained significance to the user.
 * Only create when there's user-specific context (not for casual mentions).
 *
 * Properties (for create/update tools):
 * - name: Concept name (normalized, unique per user)
 * - description: 1 sentence overview of most important information
 *
 * Notes: Use add_note_to_concept tool to add notes (notes are arrays with metadata, not strings).
 * See backend/scripts/ingestion/nodes/concept.md for complete property list.
 */
export const ConceptNodeSchema = z.object({
  name: z.string().optional().describe('Concept name (normalized, unique per user)'),
  description: z.string().optional().describe('1 sentence overview of most important information'),
});

/**
 * Entity node schema
 *
 * Represents named entities with user-specific context (companies, places,
 * objects, groups, institutions, products, technology, etc.).
 * Only create when there's user-specific context (not for casual mentions).
 *
 * Properties (for create/update tools):
 * - name: Entity name (normalized, unique per user)
 * - description: 1 sentence overview of most important information
 *
 * Notes: Use add_note_to_entity tool to add notes (notes are arrays with metadata, not strings).
 * See backend/scripts/ingestion/nodes/entity.md for complete property list.
 */
export const EntityNodeSchema = z.object({
  name: z.string().optional().describe('Entity name (normalized, unique per user)'),
  description: z.string().optional().describe('1 sentence overview of most important information'),
});

/**
 * Artifact node schema
 *
 * Represents user-generated outputs (actions, files, summaries, notes).
 * Always user-scoped, even if generated from shared team Sources.
 *
 * Properties (for create/update tools):
 * - name: Short human label
 * - description: 1 sentence summary of the artifact
 * - content: {type: action | md_file | etc, output: text | json}
 * - sensitivity: enum (low | normal | high) - default: normal
 * - ttl_policy: enum (keep_forever | decay | ephemeral)
 *
 * See backend/scripts/ingestion/nodes/artifact.md for complete property list.
 * Note: Artifacts do NOT have notes arrays (no add_note_to_artifact tool exists).
 */
export const ArtifactNodeSchema = z.object({
  name: z.string().optional().describe('Short human label for the artifact'),
  description: z.string().describe('1 sentence summary of the artifact'),
  content: z
    .object({
      type: z.string().describe('Type: action, md_file, image, etc.'),
      output: z.union([z.string(), z.record(z.string(), z.unknown())]),
    })
    .describe('Artifact content: type and output (text or JSON)'),
  sensitivity: z
    .enum(['low', 'normal', 'high'])
    .optional()
    .describe('Governance flag for permissions/access control'),
  ttl_policy: z
    .enum(['keep_forever', 'decay', 'ephemeral'])
    .optional()
    .describe('Retention policy (keep_forever > ephemeral > decay)'),
});

// ============================================================================
// Relationship Schemas
// ============================================================================

/**
 * Semantic Relationship Properties Schema
 *
 * ALL semantic relationships (Person↔Person, Person↔Concept, Person↔Entity,
 * Concept↔Concept, Concept↔Entity, Entity↔Entity) share these standardized properties.
 *
 * See backend/scripts/ingestion/relationships.md lines 13-40 for complete property list.
 * See backend/scripts/ingestion/agent-tools.md lines 126-136 for tool signature.
 *
 * Properties:
 * - relationship_type: Flexible one-word descriptor (e.g., "friend", "colleague", "studies", "works-at", "part-of")
 * - description: 1 sentence overview of the relationship nature
 * - attitude: Sentiment/valence (1-5, semantics vary by relationship type, see Word Mappings)
 * - proximity: Depth of connection/knowledge (1-5, semantics vary by relationship type)
 * - confidence: Confidence in this relationship (0-1)
 *
 * Notes: Use add_note_to_relationship tool to add notes (notes are arrays with metadata, not strings)
 *
 * Automatic properties (set by tool):
 * - relation_embedding: Generated from relationship_type + attitude/proximity word mappings
 * - notes_embedding: Initially empty, updated when notes added
 * - state: 'candidate' (default)
 * - salience: 0.5 (default)
 * - recorded_by, valid_from, valid_to, created_at, updated_at, etc.
 */
export const SemanticRelationshipSchema = z.object({
  relationship_type: z
    .string()
    .optional()
    .describe(
      'Flexible one-word descriptor (e.g., "friend", "colleague", "sibling", "uses", "studies", "works-at", "part-of")'
    ),
  description: z.string().optional().describe('1 sentence overview of the relationship nature'),
  attitude: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Sentiment/valence (1=negative, 3=neutral, 5=positive). Semantics vary by relationship type - see Word Mappings in agent-tools.md'
    ),
  proximity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Depth of connection/knowledge (1=distant/unfamiliar, 5=close/intimate). Semantics vary by relationship type - see Word Mappings'
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence in this relationship (0-1), defaults to 0.8'),
});

/**
 * Aliased schemas for backward compatibility and type discrimination.
 * All semantic relationships use the same schema now.
 */
export const PersonThinksAboutConceptSchema = SemanticRelationshipSchema;
export const PersonHasRelationshipWithPersonSchema = SemanticRelationshipSchema;
export const ConceptRelatesToConceptSchema = SemanticRelationshipSchema;
export const ConceptInvolvesPersonSchema = SemanticRelationshipSchema;
export const ConceptInvolvesEntitySchema = SemanticRelationshipSchema;
export const ConceptProducedArtifactSchema = SemanticRelationshipSchema;
export const PersonRelatesToEntitySchema = SemanticRelationshipSchema;
export const EntityRelatesToEntitySchema = SemanticRelationshipSchema;

// ============================================================================
// Tool Input Schemas
// ============================================================================

/**
 * Schema for node creation/update tool inputs
 * Used to validate inputs to create_person, update_person, etc.
 */
export const NodeToolInputSchema = z.object({
  entity_key: z.string().optional().describe('Entity key for updates, omit for creates'),
  properties: z
    .union([PersonNodeSchema, ConceptNodeSchema, EntityNodeSchema])
    .describe('Node properties varying by type'),
});

/**
 * Schema for relationship tool inputs
 * Validates relationship type and properties match allowed combinations
 */
export const RelationshipToolInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  relationship_type: z
    .enum([
      'engages_with',
      'has_relationship_with',
      'relates_to',
      'involves',
      'produced',
      'mentions',
      'sourced_from',
    ])
    .describe('Relationship type - must match allowed types'),
  properties: z
    .union([
      PersonThinksAboutConceptSchema,
      PersonHasRelationshipWithPersonSchema,
      ConceptRelatesToConceptSchema,
      ConceptInvolvesPersonSchema,
      ConceptInvolvesEntitySchema,
      ConceptProducedArtifactSchema,
      PersonRelatesToEntitySchema,
      EntityRelatesToEntitySchema,
    ])
    .describe('Relationship properties - validated based on relationship_type'),
});

/**
 * Schema for explore tool input
 * Validates semantic search queries and text matches
 */
export const ExploreInputSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().describe('Natural language query to embed and search'),
        threshold: z
          .number()
          .min(0)
          .max(1)
          .describe('Minimum cosine similarity threshold (0-1)'),
      })
    )
    .optional()
    .describe('Semantic search queries with similarity thresholds'),
  text_matches: z
    .array(z.string())
    .optional()
    .describe('Exact/fuzzy text matches to search for in entity names'),
  return_explanations: z
    .boolean()
    .optional()
    .describe('If true, include match scores and features in response'),
});

/**
 * Schema for traverse tool input
 * Validates Cypher query execution parameters
 */
export const TraverseInputSchema = z.object({
  cypher: z.string().describe('Cypher query to execute'),
  verbose: z
    .boolean()
    .describe('If false, truncate content fields (notes, description) in results'),
});

// ============================================================================
// Exports
// ============================================================================

/**
 * Type inference helpers
 * Extract TypeScript types from Zod schemas for type safety
 */
export type PersonNode = z.infer<typeof PersonNodeSchema>;
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;
export type EntityNode = z.infer<typeof EntityNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;

export type PersonThinksAboutConcept = z.infer<typeof PersonThinksAboutConceptSchema>;
export type PersonHasRelationshipWithPerson = z.infer<typeof PersonHasRelationshipWithPersonSchema>;
export type ConceptRelatesToConcept = z.infer<typeof ConceptRelatesToConceptSchema>;
export type ConceptInvolvesPerson = z.infer<typeof ConceptInvolvesPersonSchema>;
export type ConceptInvolvesEntity = z.infer<typeof ConceptInvolvesEntitySchema>;
export type ConceptProducedArtifact = z.infer<typeof ConceptProducedArtifactSchema>;
export type PersonRelatesToEntity = z.infer<typeof PersonRelatesToEntitySchema>;
export type EntityRelatesToEntity = z.infer<typeof EntityRelatesToEntitySchema>;

export type NodeToolInput = z.infer<typeof NodeToolInputSchema>;
export type RelationshipToolInput = z.infer<typeof RelationshipToolInputSchema>;
export type ExploreInput = z.infer<typeof ExploreInputSchema>;
export type TraverseInput = z.infer<typeof TraverseInputSchema>;

// ============================================================================
// Entity Resolution Schemas (Phase 2.5)
// ============================================================================

/**
 * Entity Resolution Schema - LLM output for entity matching decisions
 *
 * Used by the entity resolution service to determine if an extracted entity
 * matches an existing node in the graph.
 */
export const EntityResolutionSchema = z.object({
  resolved: z.boolean().describe('Whether extracted entity matches an existing node'),
  entity_key: z.string().uuid().optional().describe('entity_key if resolved=true'),
  reason: z.string().max(500).describe('Explanation of resolution decision')
});

/**
 * New Entity Extraction Schema - LLM output for structured entity creation
 *
 * Used when creating a new entity node to ensure proper structure and detail.
 */
export const NewEntitySchema = z.object({
  name: z.string().min(1).max(200).describe('Normalized entity name'),
  description: z.string().min(10).max(1000).describe('2-3 sentences describing the entity'),
  notes: z.array(z.string()).optional().describe('Array of key details to remember')
});

export type EntityResolution = z.infer<typeof EntityResolutionSchema>;
export type NewEntity = z.infer<typeof NewEntitySchema>;

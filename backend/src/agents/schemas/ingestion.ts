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
 * Person node schema (tech.md:15-30)
 *
 * Represents people mentioned in conversations with rich contextual information.
 * The canonical_name is required for creates but cannot be updated.
 *
 * Properties:
 * - canonical_name: Normalized name for entity resolution (required for create)
 * - name: Display name
 * - appearance: Physical description
 * - situation: Current life circumstances
 * - history: Background and context
 * - personality: Traits and quirks
 * - expertise: Professional domain
 * - interests: Hobbies and passions
 * - notes: Unstructured information that doesn't fit elsewhere
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
  notes: z
    .string()
    .optional()
    .describe('Other relevant information that does not fit structured fields'),
});

/**
 * Concept node schema (tech.md:5-13)
 *
 * Represents important concepts/topics/projects that have gained significance to the user.
 * Only create when there's user-specific context (not for casual mentions).
 *
 * Properties:
 * - name: Concept name
 * - description: 1 sentence overview of most important information
 * - notes: Unstructured information that doesn't fit elsewhere
 */
export const ConceptNodeSchema = z.object({
  name: z.string().optional().describe('Concept name'),
  description: z.string().optional().describe('1 sentence overview of most important information'),
  notes: z
    .string()
    .optional()
    .describe('Other relevant information that does not fit structured fields'),
});

/**
 * Entity node schema (tech.md:31-40)
 *
 * Represents named entities with user-specific context.
 * Types: company, place, object, group, institution, product, technology, etc.
 * Only create when there's user-specific context (not for casual mentions).
 *
 * Properties:
 * - name: Entity name
 * - type: Entity type (company, place, object, group, institution, product, technology, etc.)
 * - description: 1 sentence overview of most important information
 * - notes: Unstructured information that doesn't fit elsewhere
 */
export const EntityNodeSchema = z.object({
  name: z.string().optional().describe('Entity name'),
  type: z
    .string()
    .optional()
    .describe('Entity type: company, place, object, group, institution, product, technology, etc.'),
  description: z.string().optional().describe('1 sentence overview of most important information'),
  notes: z
    .string()
    .optional()
    .describe('Other relevant information that does not fit structured fields'),
});

/**
 * Artifact node schema (tech.md:49-55)
 *
 * Represents generated outputs, actions, files, etc. from concepts.
 * Only create when a concept produces a tangible artifact/action.
 *
 * Properties:
 * - description: 1 sentence summary of the artifact
 * - content: {type: action | md_file | etc, output: text | json}
 * - notes: Unstructured information that doesn't fit elsewhere
 */
export const ArtifactNodeSchema = z.object({
  description: z.string().describe('1 sentence summary of the artifact'),
  content: z.object({
    type: z.string().describe('Type: action, md_file, image, etc.'),
    output: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }).describe('Artifact content: type and output (text or JSON)'),
  notes: z.string().optional().describe('Other relevant information that does not fit structured fields'),
});

// ============================================================================
// Relationship Schemas (tech.md:57-118)
// ============================================================================

/**
 * Person [thinks_about] Concept relationship schema (tech.md:59-63)
 *
 * Captures user's thoughts and feelings about concepts.
 *
 * Properties:
 * - mood: Emotional stance (dreads, excited_by, loves, misses, wants, fears, etc.)
 *
 * Note: frequency is auto-managed (increments on each mention).
 */
export const PersonThinksAboutConceptSchema = z.object({
  mood: z
    .string()
    .optional()
    .describe('Emotional stance: dreads, excited_by, loves, misses, wants, fears, etc.'),
});

/**
 * Person [has_relationship_with] Person relationship schema (tech.md:65-71)
 *
 * Captures relationships between people.
 * Note: Prefer creating these only for user towards other people except in special circumstances.
 *
 * Properties:
 * - attitude_towards_person: Emotional stance (hostile, unfriendly, neutral, friendly, close, loving)
 * - closeness: How well they know each other (1-5: 1=barely know, 5=very well)
 * - relationship_type: Type (colleague, employee, partner, sister, mother, spouse, roommate, boss, friend, etc.)
 * - notes: Rich text description of the relationship
 */
export const PersonHasRelationshipWithPersonSchema = z.object({
  attitude_towards_person: z
    .string()
    .optional()
    .describe('Emotional stance: hostile, unfriendly, neutral, friendly, close, loving'),
  closeness: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How well they know each other: 1-5 (1=barely know, 5=very well)'),
  relationship_type: z
    .string()
    .optional()
    .describe(
      'Type: colleague, employee, partner, sister, mother, spouse, roommate, boss, friend, etc.'
    ),
  notes: z.string().optional().describe('Rich text description of the relationship'),
});

/**
 * Concept [relates_to] Concept relationship schema (tech.md:73-77)
 *
 * Captures connections between concepts.
 *
 * Properties:
 * - notes: Rich text description of how they're related
 * - relevance: How closely related (1-5)
 */
export const ConceptRelatesToConceptSchema = z.object({
  notes: z.string().optional().describe('Rich text description of how they are related'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

/**
 * Concept [involves] Person relationship schema (tech.md:79-83)
 *
 * Captures how people are involved in concepts.
 *
 * Properties:
 * - notes: Rich text description of involvement
 * - relevance: How closely related (1-5)
 */
export const ConceptInvolvesPersonSchema = z.object({
  notes: z.string().optional().describe('Rich text description of involvement'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

/**
 * Concept [involves] Entity relationship schema (tech.md:85-89)
 *
 * Captures how entities are involved in concepts.
 *
 * Properties:
 * - notes: Rich text description of involvement
 * - relevance: How closely related (1-5)
 */
export const ConceptInvolvesEntitySchema = z.object({
  notes: z.string().optional().describe('Rich text description of involvement'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

/**
 * Concept [produced] Artifact relationship schema (tech.md:91-95)
 *
 * Captures artifacts produced from concepts.
 *
 * Properties:
 * - notes: Rich text description of how concept produced artifact
 * - relevance: How closely related (1-5)
 */
export const ConceptProducedArtifactSchema = z.object({
  notes: z.string().optional().describe('Rich text description of how concept produced artifact'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

/**
 * Person [relates_to] Entity relationship schema (tech.md:97-102)
 *
 * Captures relationships between people and entities.
 *
 * Properties:
 * - relationship_type: Type of relationship (work, life, other, etc.)
 * - notes: Rich text description
 * - relevance: How closely related (1-5)
 */
export const PersonRelatesToEntitySchema = z.object({
  relationship_type: z
    .string()
    .optional()
    .describe('Type of relationship: work, life, other, etc.'),
  notes: z.string().optional().describe('Rich text description'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

/**
 * Entity [relates_to] Entity relationship schema (tech.md:104-109)
 *
 * Captures relationships between entities.
 *
 * Properties:
 * - relationship_type: Type (owns, part_of, near, competes_with, etc.)
 * - notes: Rich text description
 * - relevance: How closely related (1-5)
 */
export const EntityRelatesToEntitySchema = z.object({
  relationship_type: z
    .string()
    .optional()
    .describe('Type: owns, part_of, near, competes_with, etc.'),
  notes: z.string().optional().describe('Rich text description'),
  relevance: z
    .number()
    .min(1)
    .max(5)
    .optional()
    .describe('How closely related: 1-5 scale'),
});

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
      'thinks_about',
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

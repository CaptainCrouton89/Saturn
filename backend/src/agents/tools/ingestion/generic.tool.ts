/**
 * Generic Ingestion Tools for Phase 4
 *
 * Provides 6 generic tools for the ingestion agent:
 * 1. explore - Search graph for existing nodes (semantic + fuzzy)
 * 2. traverse - Navigate graph with custom Cypher queries
 * 3. createNode - Create Person/Concept/Entity nodes
 * 4. updateNode - Add notes to any existing node
 * 5. createRelationship - Create typed relationships
 * 6. updateRelationship - Update relationship properties
 *
 * These tools replace the type-specific tools (createPerson, updateConcept, etc.)
 * for a cleaner, more flexible ingestion workflow.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';
import { conceptRepository } from '../../../repositories/ConceptRepository.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';
import { personRepository } from '../../../repositories/PersonRepository.js';
import { generateEmbedding } from '../../../services/embeddingGenerationService.js';
import { parseNotes } from '../../../utils/notes.js';
import type { NoteObject } from '../../../types/graph.js';

/**
 * NoteObject schema for tool input
 */
const NoteObjectSchema = z.object({
  content: z.string().describe('The note text'),
  added_by: z.string().describe('User ID who added the note'),
  source_entity_key: z.string().nullable().optional().describe('Source conversation reference'),
  date_added: z.string().describe('ISO timestamp when note was added'),
  expires_at: z.string().nullable().optional().describe('ISO timestamp for expiration (null for permanent)'),
});

// Re-export explore and traverse tools (already generic)
export { createExploreTool } from '../retrieval/explore.tool.js';
export { createTraverseTool } from '../retrieval/traverse.tool.js';

// ============================================================================
// 3. createNode - Generic node creation
// ============================================================================

const CreateNodeInputSchema = z.object({
  node_type: z.enum(['Person', 'Concept', 'Entity']).describe('Type of node to create'),
  user_id: z.string().describe('User ID for entity_key generation'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
  source_entity_key: z.string().describe('Source node entity_key to auto-create mention relationship'),

  // Person-specific required fields
  canonical_name: z.string().optional().describe('[Person only, REQUIRED] Normalized name for entity resolution'),

  // Person-specific optional fields
  name: z.string().optional().describe('[Person] Display name'),
  is_owner: z.boolean().optional().describe('[Person] Set to true ONLY for Person representing the user'),

  // Concept-specific fields
  description: z.string().optional().describe('[Concept/Entity] 1 sentence overview'),

  // Notes (REQUIRED for all node types)
  initial_notes: z.array(NoteObjectSchema).describe('REQUIRED: Array of initial notes with all relevant details, context, and observations from the transcript. Extract rich information including specifics, examples, and nuanced details.'),

  // Entity resolution context (OPTIONAL - provided by resolution service)
  neighbor_search_results: z
    .array(
      z.object({
        entity_key: z.string(),
        name: z.string(),
        description: z.string().optional(),
        notes: z.array(z.string()).optional(),
        similarity_score: z.number(),
      })
    )
    .optional()
    .describe('[OPTIONAL] Top-K similar neighbors found during entity resolution. Use this context to inform relationship creation.'),
});

/**
 * Create a new node of any type (Person, Concept, Entity)
 *
 * Routes to appropriate repository based on node_type parameter.
 * Validates required fields per type:
 * - Person: canonical_name required
 * - Concept: name required
 * - Entity: name required
 */
export const createNodeTool = tool(
  async (input: z.infer<typeof CreateNodeInputSchema>) => {
    try {
      const validated = CreateNodeInputSchema.parse(input);
      const { node_type, user_id, last_update_source, confidence, source_entity_key } = validated;

      switch (node_type) {
        case 'Person': {
          if (!validated.canonical_name) {
            return JSON.stringify({
              success: false,
              error: 'canonical_name is required for Person nodes',
            });
          }

          // Use create() - will throw Neo4j error if Person exists
          let person;
          try {
            person = await personRepository.create(
              {
                user_id,
                canonical_name: validated.canonical_name,
                name: validated.name,
                is_owner: validated.is_owner,
                notes: validated.initial_notes as NoteObject[],
                last_update_source,
                confidence,
              },
              source_entity_key
            );
          } catch (error) {
            // Neo4j constraint error means entity already exists
            if (error instanceof Error && error.message.includes('already exists')) {
              return JSON.stringify({
                success: false,
                error: `Person "${validated.canonical_name}" already exists. Use update_node tool to add notes to existing nodes instead of creating duplicates.`,
                hint: `Call update_node to add new information to the existing Person node`,
              });
            }
            throw error; // Re-throw other errors
          }

          return JSON.stringify({
            success: true,
            entity_key: person.entity_key,
            entity_type: 'Person' as const,
            message: `Created Person: ${validated.name || validated.canonical_name}`,
          });
        }

        case 'Concept': {
          if (!validated.name) {
            return JSON.stringify({
              success: false,
              error: 'name is required for Concept nodes',
            });
          }

          // Use create() - will throw Neo4j error if Concept exists
          let concept: { entity_key: string };
          try {
            concept = await conceptRepository.create(
              {
                user_id,
                name: validated.name,
                description: validated.description !== undefined ? validated.description : '',
                notes: validated.initial_notes as NoteObject[],
              },
              {
                last_update_source,
                confidence,
              },
              source_entity_key
            );
          } catch (error) {
            // Neo4j constraint error means entity already exists
            if (error instanceof Error && error.message.includes('already exists')) {
              return JSON.stringify({
                success: false,
                error: `Concept "${validated.name}" already exists. Use update_node tool to add notes to existing nodes instead of creating duplicates.`,
                hint: `Call update_node to add new information to the existing Concept node`,
              });
            }
            throw error; // Re-throw other errors
          }

          return JSON.stringify({
            success: true,
            entity_key: concept.entity_key,
            entity_type: 'Concept' as const,
            message: `Created Concept: ${validated.name}`,
          });
        }

        case 'Entity': {
          if (!validated.name) {
            return JSON.stringify({
              success: false,
              error: 'name is required for Entity nodes',
            });
          }

          // Use create() - will throw Neo4j error if Entity exists
          let entity: { entity_key: string };
          try {
            entity = await entityRepository.create(
              {
                user_id,
                name: validated.name,
                description: validated.description !== undefined ? validated.description : '',
                notes: validated.initial_notes as NoteObject[],
                last_update_source,
                confidence,
              },
              source_entity_key
            );
          } catch (error) {
            // Neo4j constraint error means entity already exists
            if (error instanceof Error && error.message.includes('already exists')) {
              return JSON.stringify({
                success: false,
                error: `Entity "${validated.name}" already exists. Use update_node tool to add notes to existing nodes instead of creating duplicates.`,
                hint: `Call update_node to add new information to the existing Entity node`,
              });
            }
            throw error; // Re-throw other errors
          }

          return JSON.stringify({
            success: true,
            entity_key: entity.entity_key,
            entity_type: 'Entity' as const,
            message: `Created Entity: ${validated.name}`,
          });
        }

        default:
          return JSON.stringify({
            success: false,
            error: `Unsupported node type: ${node_type}`,
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'create_node',
    description:
      'Create a new node in the knowledge graph. ' +
      'Specify node_type (Person, Concept, Entity) and provide required fields: ' +
      'Person requires canonical_name; Concept and Entity both require name. ' +
      'ALL nodes REQUIRE initial_notes: an array of note objects with all relevant details, context, and observations from the transcript. Extract rich information including specifics, examples, and nuanced details. ' +
      'All nodes require user_id, last_update_source (conversation_id), and confidence (0-1). ' +
      'Optional: source_entity_key (auto-creates mention relationship). ' +
      'Person supports optional fields: name, is_owner. ' +
      'Concept/Entity support optional: description.',
    schema: CreateNodeInputSchema,
  }
);

// ============================================================================
// 4. updateNode - Generic note addition to any node
// ============================================================================

const UpdateNodeInputSchema = z.object({
  entity_key: z.string().describe('Entity key of node to update'),
  note_content: z.string().describe('Note text to append'),
  lifetime: z
    .enum(['week', 'month', 'year', 'forever'])
    .optional()
    .default('month')
    .describe('How long note should persist before expiring'),
  // Entity resolution parameters
  operation: z
    .enum(['append', 'replace'])
    .optional()
    .default('append')
    .describe('How to update notes: "append" (add to existing, default) or "replace" (overwrite all notes)'),
  preserve_existing: z
    .boolean()
    .optional()
    .default(true)
    .describe('If true (default), preserve existing notes when appending. If false, allow overwriting.'),
  // Context properties (automatically provided by framework)
  added_by: z.string().optional().describe('[AUTOMATIC] User ID - provided by ingestion context'),
  source_entity_key: z
    .string()
    .nullable()
    .optional()
    .describe('[AUTOMATIC] Source entity_key - provided by ingestion context'),
});

/**
 * Calculate expires_at ISO timestamp based on lifetime
 */
function getExpiresAt(lifetime: string): string | null {
  const now = Date.now();
  switch (lifetime) {
    case 'forever':
      return null;
    case 'week':
      return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month':
      return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    case 'year':
      return new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();
    default:
      return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
}

/**
 * Add a note to any node type (Person, Concept, Entity)
 *
 * Automatically detects node type from graph and appends note.
 * Marks node as is_dirty for later consolidation.
 */
export const updateNodeTool = tool(
  async (input: z.infer<typeof UpdateNodeInputSchema>) => {
    try {
      const validated = UpdateNodeInputSchema.parse(input);
      const { entity_key, note_content, lifetime, operation, preserve_existing } = validated;

      if (!validated.added_by) {
        throw new Error('added_by is required but was not provided by ingestion framework context');
      }

      // Detect node type
      const typeQuery = `
        MATCH (n {entity_key: $entity_key})
        WHERE labels(n)[0] IN ['Person', 'Concept', 'Entity']
        RETURN labels(n)[0] AS node_type, n.notes AS notes
      `;

      const typeResult = await neo4jService.executeQuery<{
        node_type: string;
        notes: Array<{
          content: string;
          added_by: string;
          source_entity_key: string | null;
          date_added: string;
          expires_at: string | null;
        }> | null;
      }>(typeQuery, {
        entity_key,
      });

      if (!typeResult[0]) {
        return JSON.stringify({
          success: false,
          error: `Node with entity_key ${entity_key} not found or is not a semantic node (Person/Concept/Entity)`,
        });
      }

      const { node_type, notes } = typeResult[0];

      const existingNotes: NoteObject[] = parseNotes(notes);

      // Create new note object
      const newNote = {
        content: note_content,
        added_by: validated.added_by,
        source_entity_key: validated.source_entity_key || null,
        date_added: new Date().toISOString(),
        expires_at: getExpiresAt(lifetime),
      };

      // Determine final notes array based on operation mode
      let updatedNotes: typeof existingNotes;
      if (operation === 'replace') {
        // Replace mode: overwrite all existing notes
        updatedNotes = [newNote];
      } else {
        // Append mode (default): add to existing notes
        if (preserve_existing) {
          updatedNotes = [...existingNotes, newNote];
        } else {
          // Allow overwriting if preserve_existing is false
          updatedNotes = [newNote];
        }
      }

      // Update with native Cypher list
      const updateQuery = `
        MATCH (n:${node_type} {entity_key: $entity_key})
        SET n.notes = $updatedNotes,
        n.is_dirty = true,
        n.updated_at = datetime()
        RETURN n.entity_key AS entity_key
      `;

      const result = await neo4jService.executeQuery<{ entity_key: string }>(updateQuery, {
        entity_key,
        updatedNotes: updatedNotes,
      });

      if (!result[0]) {
        return JSON.stringify({
          success: false,
          error: `Failed to update node ${entity_key}`,
        });
      }

      return JSON.stringify({
        success: true,
        message: `${operation === 'replace' ? 'Replaced' : 'Added'} note ${operation === 'append' ? 'to' : 'for'} ${node_type} ${entity_key}`,
        note_lifetime: lifetime,
        operation: operation,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'update_node',
    description:
      'Add or update notes on any existing node (Person, Concept, Entity). ' +
      'Automatically detects node type. ' +
      'Required: entity_key, note_content. ' +
      'Optional: lifetime (week/month/year/forever, default: month), operation ("append" adds to existing notes [default], "replace" overwrites all notes), preserve_existing (true=keep old notes when appending [default], false=allow overwriting). ' +
      'NOTE: added_by and source_entity_key are automatically provided by the ingestion framework. ' +
      'For entity resolution, always use operation="append" and preserve_existing=true to avoid data loss.',
    schema: UpdateNodeInputSchema,
  }
);

// ============================================================================
// 5. createRelationship - Already exists, re-export
// ============================================================================

export { createRelationshipTool } from '../relationships/relationship.tool.js';

// ============================================================================
// 6. updateRelationship - Generic relationship update
// ============================================================================

/**
 * Word mappings for attitude/proximity scores (1-5)
 * Used to regenerate relation_embedding when properties change
 */
const WORD_MAPPINGS = {
  has_relationship_with: {
    attitude: ['hostile', 'unfriendly', 'neutral', 'friendly', 'close'],
    proximity: ['stranger', 'acquaintance', 'familiar', 'known-well', 'intimate-knowledge'],
  },
  engages_with: {
    attitude: ['dislikes', 'skeptical', 'neutral', 'interested', 'passionate'],
    proximity: ['unfamiliar', 'aware', 'understands', 'experienced', 'expert'],
  },
  associated_with: {
    attitude: ['negative-view', 'unfavorable', 'neutral', 'favorable', 'strongly-positive'],
    proximity: ['distant', 'aware-of', 'familiar-with', 'involved-with', 'deeply-connected'],
  },
  relates_to: {
    attitude: ['contradicts', 'conflicts', 'independent', 'complementary', 'integral'],
    proximity: ['loosely-related', 'somewhat-related', 'related', 'closely-related', 'inseparable'],
  },
  involves: {
    attitude: ['peripheral', 'minor', 'relevant', 'important', 'central'],
    proximity: ['tangential', 'mentioned', 'involved', 'key-component', 'essential'],
  },
  connected_to: {
    attitude: ['adversarial', 'competing', 'independent', 'cooperative', 'integrated'],
    proximity: ['distantly-connected', 'indirectly-connected', 'connected', 'closely-linked', 'tightly-coupled'],
  },
} as const;

/**
 * Get attitude/proximity words for embedding generation
 */
function getWords(
  relType: keyof typeof WORD_MAPPINGS,
  attitude: number,
  proximity: number
): { attitudeWord: string; proximityWord: string } {
  const mapping = WORD_MAPPINGS[relType];
  const attitudeWord = mapping.attitude[attitude - 1]; // 1-indexed to 0-indexed
  const proximityWord = mapping.proximity[proximity - 1];
  return { attitudeWord, proximityWord };
}

const UpdateRelationshipInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  description: z.string().optional().describe('Updated 1-sentence overview of the relationship'),
  relationship_type: z
    .string()
    .optional()
    .describe('Updated one-word descriptor (e.g., "friend", "colleague", "studies")'),
  attitude: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Updated sentiment/valence: 1=negative, 3=neutral, 5=positive'),
  proximity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Updated depth of connection: 1=distant, 5=close'),
});

/**
 * Update an existing relationship's properties
 *
 * Automatically detects relationship type from graph.
 * Updates any combination of: description, relationship_type, attitude, proximity.
 * Regenerates relation_embedding if properties change.
 */
export const updateRelationshipTool = tool(
  async (input: z.infer<typeof UpdateRelationshipInputSchema>) => {
    const { from_entity_key, to_entity_key, description, relationship_type, attitude, proximity } = input;

    try {
      // Detect relationship type and get current values
      const getQuery = `
        MATCH (from {entity_key: $from_entity_key})-[r]->(to {entity_key: $to_entity_key})
        WHERE type(r) IN ['has_relationship_with', 'engages_with', 'associated_with', 'relates_to', 'involves', 'connected_to']
        RETURN
          type(r) as cypher_rel_type,
          r.relationship_type as current_relationship_type,
          r.attitude as current_attitude,
          r.proximity as current_proximity,
          r.description as current_description
      `;

      const current = await neo4jService.executeQuery<{
        cypher_rel_type: string;
        current_relationship_type: string;
        current_attitude: number;
        current_proximity: number;
        current_description: string | null;
      }>(getQuery, { from_entity_key, to_entity_key });

      if (!current[0]) {
        return JSON.stringify({
          success: false,
          error: `Relationship not found between ${from_entity_key} and ${to_entity_key}`,
        });
      }

      const cypherRelType = current[0].cypher_rel_type as keyof typeof WORD_MAPPINGS;

      // Determine if properties changed
      const propertiesChanged =
        (relationship_type !== undefined && relationship_type !== current[0].current_relationship_type) ||
        (attitude !== undefined && attitude !== current[0].current_attitude) ||
        (proximity !== undefined && proximity !== current[0].current_proximity);

      // Determine if description changed
      const descriptionChanged = description !== undefined && description !== current[0].current_description;

      // Build SET clause dynamically
      const updates: string[] = [];
      const params: Record<string, unknown> = {
        from_entity_key,
        to_entity_key,
      };

      if (description !== undefined) {
        updates.push('r.description = $description');
        params.description = description;
      }

      if (relationship_type !== undefined) {
        updates.push('r.relationship_type = $relationship_type');
        params.relationship_type = relationship_type;
      }

      if (attitude !== undefined) {
        updates.push('r.attitude = $attitude');
        params.attitude = attitude;
      }

      if (proximity !== undefined) {
        updates.push('r.proximity = $proximity');
        params.proximity = proximity;
      }

      // If properties changed, regenerate relation_embedding
      if (propertiesChanged) {
        const finalRelType = relationship_type ?? current[0].current_relationship_type;
        const finalAttitude = attitude ?? current[0].current_attitude;
        const finalProximity = proximity ?? current[0].current_proximity;

        const { attitudeWord, proximityWord } = getWords(cypherRelType, finalAttitude, finalProximity);
        const relationText = `${finalRelType} ${attitudeWord} ${proximityWord}`;
        const relationEmbedding = await generateEmbedding(relationText);

        updates.push('r.relation_embedding = $relation_embedding');
        params.relation_embedding = relationEmbedding;
      }

      // If description changed, regenerate description_embedding
      if (descriptionChanged) {
        const newDescription = description ?? current[0].current_description ?? '';
        const descriptionEmbedding = newDescription && newDescription.length > 0
          ? await generateEmbedding(newDescription)
          : [];

        updates.push('r.description_embedding = $description_embedding');
        params.description_embedding = descriptionEmbedding;
      }

      // Always update updated_at
      updates.push('r.updated_at = datetime()');

      if (updates.length === 1) {
        // Only updated_at would be set
        return JSON.stringify({
          success: true,
          properties_changed: false,
          message: 'No properties to update',
        });
      }

      // Execute update
      const updateQuery = `
        MATCH (from {entity_key: $from_entity_key})-[r:${cypherRelType}]->(to {entity_key: $to_entity_key})
        SET ${updates.join(', ')}
        RETURN r
      `;

      await neo4jService.executeQuery(updateQuery, params);

      return JSON.stringify({
        success: true,
        properties_changed: propertiesChanged,
        message: `Updated ${cypherRelType} relationship${propertiesChanged ? ' (relation_embedding regenerated)' : ''}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'update_relationship',
    description:
      'Update an existing relationship between two nodes. ' +
      'Automatically detects relationship type (has_relationship_with, engages_with, associated_with, relates_to, involves, connected_to). ' +
      'Optional fields: description, relationship_type, attitude (1=negative→5=positive), proximity (1=distant→5=close). ' +
      'Regenerates relation_embedding if properties change.',
    schema: UpdateRelationshipInputSchema,
  }
);

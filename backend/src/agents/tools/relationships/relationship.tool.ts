/**
 * Unified relationship creation tool matching agent-tools.md spec
 *
 * Single API for creating relationships between any node types.
 * Automatically determines Cypher relationship type based on node types
 * and generates semantic embeddings from attitude/proximity mappings.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';
import { generateEmbedding } from '../../../services/embeddingGenerationService.js';

/**
 * Word mappings for attitude/proximity scores (1-5)
 * Used to generate relation_embedding for semantic relationship search
 */
const WORD_MAPPINGS = {
  has_relationship_with: {
    // Person → Person
    attitude: ['hostile', 'unfriendly', 'neutral', 'friendly', 'close'],
    proximity: ['stranger', 'acquaintance', 'familiar', 'known-well', 'intimate-knowledge'],
  },
  engages_with: {
    // Person → Concept
    attitude: ['dislikes', 'skeptical', 'neutral', 'interested', 'passionate'],
    proximity: ['unfamiliar', 'aware', 'understands', 'experienced', 'expert'],
  },
  associated_with: {
    // Person → Entity
    attitude: ['negative-view', 'unfavorable', 'neutral', 'favorable', 'strongly-positive'],
    proximity: ['distant', 'aware-of', 'familiar-with', 'involved-with', 'deeply-connected'],
  },
  relates_to: {
    // Concept → Concept
    attitude: ['contradicts', 'conflicts', 'independent', 'complementary', 'integral'],
    proximity: ['loosely-related', 'somewhat-related', 'related', 'closely-related', 'inseparable'],
  },
  involves: {
    // Concept → Entity
    attitude: ['peripheral', 'minor', 'relevant', 'important', 'central'],
    proximity: ['tangential', 'mentioned', 'involved', 'key-component', 'essential'],
  },
  connected_to: {
    // Entity → Entity
    attitude: ['adversarial', 'competing', 'independent', 'cooperative', 'integrated'],
    proximity: ['distantly-connected', 'indirectly-connected', 'connected', 'closely-linked', 'tightly-coupled'],
  },
} as const;

/**
 * Determine Cypher relationship type based on node labels
 */
function getCypherRelationshipType(fromLabel: string, toLabel: string): string {
  if (fromLabel === 'Person' && toLabel === 'Person') return 'has_relationship_with';
  if (fromLabel === 'Person' && toLabel === 'Concept') return 'engages_with';
  if (fromLabel === 'Person' && toLabel === 'Entity') return 'associated_with';
  if (fromLabel === 'Concept' && toLabel === 'Concept') return 'relates_to';
  if (fromLabel === 'Concept' && toLabel === 'Entity') return 'involves';
  if (fromLabel === 'Entity' && toLabel === 'Entity') return 'connected_to';

  throw new Error(`Unsupported node type combination: ${fromLabel} → ${toLabel}`);
}

/**
 * Get attitude/proximity words for embedding generation
 */
function getWords(
  cypherRelType: keyof typeof WORD_MAPPINGS,
  attitude: number,
  proximity: number
): { attitudeWord: string; proximityWord: string } {
  const mapping = WORD_MAPPINGS[cypherRelType];
  const attitudeWord = mapping.attitude[attitude - 1]; // 1-indexed to 0-indexed
  const proximityWord = mapping.proximity[proximity - 1];
  return { attitudeWord, proximityWord };
}

/**
 * Input schema for relationship creation
 */
const CreateRelationshipInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  relationship_type: z
    .string()
    .describe('One-word descriptor (e.g., "friend", "colleague", "studies", "works-at", "part-of")'),
  description: z.string().describe('1-sentence overview of the relationship nature'),
  attitude: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('Sentiment/valence: 1=negative, 3=neutral, 5=positive (semantics vary by relationship type)'),
  proximity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('Depth of connection: 1=distant, 5=close (semantics vary by relationship type)'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.8)
    .describe('Confidence in this relationship (0-1), defaults to 0.8'),
});

/**
 * Create a typed bidirectional relationship between two nodes
 *
 * Automatically determines Cypher relationship type based on node types
 * and generates semantic embeddings from attitude/proximity mappings.
 *
 * Per agent-tools.md spec.
 */
export const createRelationshipTool = tool(
  async (input: z.infer<typeof CreateRelationshipInputSchema>) => {
    const { from_entity_key, to_entity_key, relationship_type, description, attitude, proximity, confidence } = input;

    try {
      // Step 1: Get node labels to determine Cypher relationship type
      const nodesQuery = `
        MATCH (from {entity_key: $from_entity_key})
        MATCH (to {entity_key: $to_entity_key})
        RETURN labels(from)[0] as fromLabel, labels(to)[0] as toLabel
      `;
      const nodesResult = await neo4jService.executeQuery<{ fromLabel: string; toLabel: string }>(nodesQuery, {
        from_entity_key,
        to_entity_key,
      });

      if (!nodesResult[0]) {
        return JSON.stringify({
          success: false,
          error: 'One or both nodes do not exist',
        });
      }

      const { fromLabel, toLabel } = nodesResult[0];

      // Step 2: Determine Cypher relationship type
      const cypherRelType = getCypherRelationshipType(fromLabel, toLabel);

      // Step 3: Get words for embedding
      const { attitudeWord, proximityWord } = getWords(
        cypherRelType as keyof typeof WORD_MAPPINGS,
        attitude,
        proximity
      );

      // Step 4: Check if relationship already exists
      const checkQuery = `
        MATCH (from {entity_key: $from_entity_key})
        MATCH (to {entity_key: $to_entity_key})
        OPTIONAL MATCH (from)-[existing:${cypherRelType}]->(to)
        RETURN existing IS NOT NULL as exists
      `;
      const checkResult = await neo4jService.executeQuery<{ exists: boolean }>(checkQuery, {
        from_entity_key,
        to_entity_key,
      });

      if (checkResult[0]?.exists) {
        return JSON.stringify({
          success: false,
          error: `Relationship already exists between ${from_entity_key} and ${to_entity_key}. Use update_relationship tool to modify existing relationships instead of creating duplicates.`,
          hint: 'Call update_relationship with from_entity_key and to_entity_key to add notes or update properties',
        });
      }

      // Step 5: Generate relation_embedding
      const relationText = `${relationship_type} ${attitudeWord} ${proximityWord}`;
      const relationEmbedding = await generateEmbedding(relationText);

      // Step 6: Create relationship with all properties
      const createQuery = `
        MATCH (from {entity_key: $from_entity_key})
        MATCH (to {entity_key: $to_entity_key})
        CREATE (from)-[r:${cypherRelType}]->(to)
        SET
          r.relationship_type = $relationship_type,
          r.description = $description,
          r.attitude = $attitude,
          r.proximity = $proximity,
          r.confidence = $confidence,
          r.relation_embedding = $relation_embedding,
          r.notes_embedding = [],
          r.state = 'candidate',
          r.salience = 0.5,
          r.recorded_by = $user_id,
          r.valid_from = datetime(),
          r.valid_to = null,
          r.created_at = datetime(),
          r.updated_at = datetime(),
          r.recall_frequency = 0,
          r.last_recall_interval = 0,
          r.decay_gradient = 1.0,
          r.access_count = 0,
          r.last_accessed_at = null,
          r.is_dirty = false,
          r.notes = []
        RETURN r
      `;

      // Get user_id from context (should be set by phase4.ts)
      // For now, default to empty string (will be overridden by caller)
      const user_id = ''; // TODO: Get from context

      const result = await neo4jService.executeQuery<{ r: unknown }>(createQuery, {
        from_entity_key,
        to_entity_key,
        relationship_type,
        description,
        attitude,
        proximity,
        confidence,
        relation_embedding: relationEmbedding,
        user_id,
      });

      if (!result[0]) {
        return JSON.stringify({
          success: false,
          error: 'Failed to create relationship',
        });
      }

      return JSON.stringify({
        success: true,
        message: `Created ${cypherRelType} relationship: ${relationship_type} from ${from_entity_key} to ${to_entity_key}`,
        cypher_relationship_type: cypherRelType,
        relation_text: relationText,
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
    name: 'create_relationship',
    description:
      'Create a typed bidirectional relationship between two nodes. ' +
      'Automatically determines relationship type (has_relationship_with, engages_with, associated_with, relates_to, involves, connected_to) ' +
      'based on node types. Generates semantic embeddings from attitude/proximity scores. ' +
      'Attitude: 1=negative → 5=positive. Proximity: 1=distant → 5=close. ' +
      'Semantics vary by relationship type (see agent-tools.md for word mappings).',
    schema: CreateRelationshipInputSchema,
  }
);

/**
 * Input schema for adding notes to relationships
 */
const AddNoteToRelationshipInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  note_content: z.string().describe('Text content of the note'),
  lifetime: z
    .enum(['week', 'month', 'year', 'forever'])
    .optional()
    .default('month')
    .describe('Retention policy: week, month, year, forever'),
});

/**
 * Add a note to a relationship and regenerate notes_embedding
 *
 * Per agent-tools.md spec.
 */
export const addNoteToRelationshipTool = tool(
  async (input: z.infer<typeof AddNoteToRelationshipInputSchema>) => {
    const { from_entity_key, to_entity_key, note_content, lifetime } = input;

    try {
      // Calculate expires_at based on lifetime
      let expires_at_cypher: string;
      switch (lifetime) {
        case 'week':
          expires_at_cypher = 'datetime() + duration({days: 7})';
          break;
        case 'month':
          expires_at_cypher = 'datetime() + duration({days: 30})';
          break;
        case 'year':
          expires_at_cypher = 'datetime() + duration({days: 365})';
          break;
        case 'forever':
          expires_at_cypher = 'null';
          break;
      }

      // Get user_id and source_entity_key from context
      // For now, default to empty strings (will be overridden by caller)
      const user_id = ''; // TODO: Get from context
      const source_entity_key = ''; // TODO: Get from context

      // Add note to relationship
      const addNoteQuery = `
        MATCH (from {entity_key: $from_entity_key})-[r]->(to {entity_key: $to_entity_key})
        SET r.notes = coalesce(r.notes, []) + [{
          content: $note_content,
          added_by: $user_id,
          source_entity_key: $source_entity_key,
          date_added: datetime(),
          expires_at: ${expires_at_cypher}
        }],
        r.is_dirty = true,
        r.updated_at = datetime()
        RETURN r.notes as notes
      `;

      const addResult = await neo4jService.executeQuery<{ notes: Array<{ content: string }> }>(addNoteQuery, {
        from_entity_key,
        to_entity_key,
        note_content,
        user_id,
        source_entity_key,
      });

      if (!addResult[0]) {
        return JSON.stringify({
          success: false,
          error: 'Relationship not found',
        });
      }

      // Regenerate notes_embedding from concatenated notes (max 1000 chars)
      const notes = addResult[0].notes;
      const notesText = notes
        .map((n) => n.content)
        .join(' ')
        .substring(0, 1000);
      const notesEmbedding = notesText.length > 0 ? await generateEmbedding(notesText) : [];

      // Update notes_embedding
      const updateEmbeddingQuery = `
        MATCH (from {entity_key: $from_entity_key})-[r]->(to {entity_key: $to_entity_key})
        SET r.notes_embedding = $notes_embedding
        RETURN r
      `;

      await neo4jService.executeQuery(updateEmbeddingQuery, {
        from_entity_key,
        to_entity_key,
        notes_embedding: notesEmbedding,
      });

      return JSON.stringify({
        success: true,
        message: `Added note to relationship from ${from_entity_key} to ${to_entity_key}`,
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
    name: 'add_note_to_relationship',
    description:
      'Append a note to a relationship and regenerate notes_embedding. ' +
      'Lifetime options: week (7 days), month (30 days), year (365 days), forever (never expires). ' +
      'Automatically tracks authorship and provenance.',
    schema: AddNoteToRelationshipInputSchema,
  }
);

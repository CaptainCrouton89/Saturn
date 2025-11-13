/**
 * Relationship Update Tools for Phase 5 Consolidation
 *
 * Six separate tools for updating each relationship type's properties.
 * Used by consolidation agents to update relationships based on accumulated notes.
 *
 * Each tool:
 * - Accepts from_entity_key, to_entity_key to identify relationship
 * - Optional: description, relationship_type, attitude, proximity
 * - Returns: { success, properties_changed } to track if relation_embedding needs regeneration
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';
import { generateEmbedding } from '../../../services/embeddingGenerationService.js';

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

/**
 * Base schema for all relationship update operations
 */
const BaseUpdateSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  description: z.string().optional().describe('Updated 1-sentence overview of the relationship'),
  relationship_type: z.string().optional().describe('Updated one-word descriptor (e.g., "friend", "colleague", "studies")'),
  attitude: z.number().int().min(1).max(5).optional().describe('Updated sentiment/valence: 1=negative, 3=neutral, 5=positive'),
  proximity: z.number().int().min(1).max(5).optional().describe('Updated depth of connection: 1=distant, 5=close'),
});

/**
 * Generic update function for all relationship types
 */
async function updateRelationship(
  input: z.infer<typeof BaseUpdateSchema>,
  cypherRelType: keyof typeof WORD_MAPPINGS
) {
  const { from_entity_key, to_entity_key, description, relationship_type, attitude, proximity } = input;

  try {
    // Check if relationship exists and get current values
    const getQuery = `
      MATCH (from {entity_key: $from_entity_key})-[r:${cypherRelType}]->(to {entity_key: $to_entity_key})
      RETURN r.relationship_type as current_relationship_type, r.attitude as current_attitude, r.proximity as current_proximity
    `;

    const current = await neo4jService.executeQuery<{
      current_relationship_type: string;
      current_attitude: number;
      current_proximity: number;
    }>(getQuery, { from_entity_key, to_entity_key });

    if (!current[0]) {
      return JSON.stringify({
        success: false,
        error: `Relationship not found between ${from_entity_key} and ${to_entity_key}`,
      });
    }

    // Determine if properties changed
    const propertiesChanged =
      (relationship_type !== undefined && relationship_type !== current[0].current_relationship_type) ||
      (attitude !== undefined && attitude !== current[0].current_attitude) ||
      (proximity !== undefined && proximity !== current[0].current_proximity);

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

    // Always update updated_at
    updates.push('r.updated_at = datetime()');

    if (updates.length === 1) {
      // Only updated_at would be set, nothing to actually update
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
}

// ============================================================================
// Tool Definitions (6 relationship types)
// ============================================================================

/**
 * Update has_relationship_with (Person → Person)
 */
export const updateHasRelationshipWithTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'has_relationship_with');
  },
  {
    name: 'update_has_relationship_with',
    description:
      'Update a Person→Person relationship. Optional fields: description, relationship_type, attitude (1=hostile→5=close), proximity (1=stranger→5=intimate-knowledge). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Update engages_with (Person → Concept)
 */
export const updateEngagesWithTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'engages_with');
  },
  {
    name: 'update_engages_with',
    description:
      'Update a Person→Concept relationship. Optional fields: description, relationship_type, attitude (1=dislikes→5=passionate), proximity (1=unfamiliar→5=expert). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Update associated_with (Person → Entity)
 */
export const updateAssociatedWithTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'associated_with');
  },
  {
    name: 'update_associated_with',
    description:
      'Update a Person→Entity relationship. Optional fields: description, relationship_type, attitude (1=negative-view→5=strongly-positive), proximity (1=distant→5=deeply-connected). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Update relates_to (Concept → Concept)
 */
export const updateRelatesToTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'relates_to');
  },
  {
    name: 'update_relates_to',
    description:
      'Update a Concept→Concept relationship. Optional fields: description, relationship_type, attitude (1=contradicts→5=integral), proximity (1=loosely-related→5=inseparable). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Update involves (Concept → Entity)
 */
export const updateInvolvesTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'involves');
  },
  {
    name: 'update_involves',
    description:
      'Update a Concept→Entity relationship. Optional fields: description, relationship_type, attitude (1=peripheral→5=central), proximity (1=tangential→5=essential). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Update connected_to (Entity → Entity)
 */
export const updateConnectedToTool = tool(
  async (input: z.infer<typeof BaseUpdateSchema>) => {
    return updateRelationship(input, 'connected_to');
  },
  {
    name: 'update_connected_to',
    description:
      'Update an Entity→Entity relationship. Optional fields: description, relationship_type, attitude (1=adversarial→5=integrated), proximity (1=distantly-connected→5=tightly-coupled). Returns properties_changed flag.',
    schema: BaseUpdateSchema,
  }
);

/**
 * Node Update Tool Factory
 *
 * Creates type-specific tools for updating Person, Concept, and Entity nodes.
 * Strictly additive - appends notes to existing notes array.
 * Regenerates node_embedding from name + description + notes.
 *
 * Part of Tool Consolidation Plan (TOOL_CONSOLIDATION_PLAN.md)
 */

import { tool } from 'ai';
import { z } from 'zod';
import { conceptRepository } from '../../../repositories/ConceptRepository.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';
import { personRepository } from '../../../repositories/PersonRepository.js';
import type { Concept, Entity, EntityType, NoteObject, Person } from '../../../types/graph.js';
import { generateNodeEmbedding, getExpiresAt } from '../../../utils/nodeHelpers.js';
import { parseNotes } from '../../../utils/notes.js';

// NodeType for tool factory (capitalized Neo4j labels)
type NodeType = EntityType; 

/**
 * Get node description text for different node types
 */
function getNodeDescription(nodeType: NodeType): string {
  const lifetimeDesc = 'Lifetime: week (7d), month (30d), year (365d), forever (permanent).';

  switch (nodeType) {
    case 'person':
      return `Add note to Person node. Strictly additive - appends to existing notes. ${lifetimeDesc}`;
    case 'concept':
      return `Add note to Concept node. Strictly additive - appends to existing notes. ${lifetimeDesc}`;
    case 'entity':
      return `Add note to Entity node. Strictly additive - appends to existing notes. ${lifetimeDesc}`;
  }
}

/**
 * Factory function to create generic node update tool with bound context
 * Infers node type from entity_key prefix rather than requiring explicit type parameter
 *
 * @param userId - User ID to auto-inject into notes
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param nodeType - Optional node type (Person, Concept, Entity). If omitted, creates generic tool that infers type from entity_key
 * @returns Configured tool for updating nodes
 */
export function updateNodeTool(userId: string, sourceEntityKey: string, nodeType?: NodeType) {
  const schema = z.object({
    entity_key: z.string().describe('Entity key of the node to update'),
    notes: z
      .array(
        z.object({
          content: z
            .string()
            .describe(
              'Information-dense incomplete sentence. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
            ),
          lifetime: z
            .enum(['week', 'month', 'year', 'forever'])
            .describe('How long this note should be retained'),
        })
      )
      .min(1)
      .describe('Array of notes to add to the node. Each note can have a different lifetime.'),
  });

  return tool({
    description: nodeType
      ? getNodeDescription(nodeType)
      : 'Add note to any node (Person, Concept, or Entity). Infers type from entity_key prefix. Strictly additive - appends to existing notes. Lifetime: week (7d), month (30d), year (365d), forever (permanent).',
    parameters: schema,
    execute: async (input) => {
      try {
        const { entity_key, notes } = input;

        // Create new note objects with auto-injected fields
        const newNotes: NoteObject[] = notes.map((note) => ({
          content: note.content,
          added_by: userId,
          source_entity_key: sourceEntityKey,
          date_added: new Date().toISOString(),
          expires_at: getExpiresAt(note.lifetime),
        }));

        // Infer node type from entity_key prefix if not provided
        let inferredNodeType: NodeType;
        if (nodeType) {
          inferredNodeType = nodeType;
        } else {
          // entity_key format: "person:...", "concept:...", "entity:..."
          const prefix = entity_key.split(':')[0];
          if (prefix === 'person') {
            inferredNodeType = 'person';
          } else if (prefix === 'concept') {
            inferredNodeType = 'concept';
          } else if (prefix === 'entity') {
            inferredNodeType = 'entity';
          } else {
            return JSON.stringify({
              success: false,
              error: `Unable to infer node type from entity_key: ${entity_key}`,
            });
          }
        }

        // Route to appropriate repository based on node type
        let existingNode: Person | Concept | Entity | null = null;
        let updatedNode: Person | Concept | Entity;
        let nodeName: string;

        switch (inferredNodeType) {
          case 'person': {
            existingNode = await personRepository.findById(entity_key);
            if (!existingNode) {
              return JSON.stringify({
                success: false,
                error: `Person node with entity_key ${entity_key} not found`,
              });
            }

            // Append notes to existing notes (repository already returns parsed array)
            const existingNotes = Array.isArray(existingNode.notes)
              ? existingNode.notes
              : parseNotes(existingNode.notes);
            const updatedNotes = [...existingNotes, ...newNotes];

            // Generate new embedding
            const embedding = await generateNodeEmbedding(
              existingNode.name,
              existingNode.description,
              updatedNotes
            );

            // Update node with new notes and embedding
            updatedNode = await personRepository.update({
              entity_key,
              notes: updatedNotes,
              embedding,
              last_update_source: sourceEntityKey,
              confidence: 0.9, // High confidence for direct note addition
            });

            nodeName = updatedNode.name;
            break;
          }

          case 'concept': {
            existingNode = await conceptRepository.findById(entity_key);
            if (!existingNode) {
              return JSON.stringify({
                success: false,
                error: `Concept node with entity_key ${entity_key} not found`,
              });
            }

            // Append notes to existing notes (repository already returns parsed array)
            const existingNotes = Array.isArray(existingNode.notes)
              ? existingNode.notes
              : parseNotes(existingNode.notes);
            const updatedNotes = [...existingNotes, ...newNotes];

            // Generate new embedding
            const embedding = await generateNodeEmbedding(
              existingNode.name,
              existingNode.description,
              updatedNotes
            );

            // Update node with new notes (embedding handled separately)
            const result = await conceptRepository.update(
              entity_key,
              {
                notes: updatedNotes,
              },
              {
                last_update_source: sourceEntityKey,
                confidence: 0.9,
              }
            );

            // Update embedding directly via Neo4j (ConceptRepository.update doesn't support embedding parameter)
            const { neo4jService } = await import('../../../db/neo4j.js');
            await neo4jService.executeQuery(
              `
              MATCH (c:Concept {entity_key: $entity_key})
              SET c.embedding = $embedding
              `,
              { entity_key, embedding }
            );

            // Fetch updated node to return
            const updated = await conceptRepository.findById(result.entity_key);
            if (!updated) {
              throw new Error('Failed to fetch updated concept');
            }
            updatedNode = updated;
            nodeName = updatedNode.name;
            break;
          }

          case 'entity': {
            existingNode = await entityRepository.findById(entity_key);
            if (!existingNode) {
              return JSON.stringify({
                success: false,
                error: `Entity node with entity_key ${entity_key} not found`,
              });
            }

            // Append notes to existing notes (repository already returns parsed array)
            const existingNotes = Array.isArray(existingNode.notes)
              ? existingNode.notes
              : parseNotes(existingNode.notes);
            const updatedNotes = [...existingNotes, ...newNotes];

            // Generate new embedding
            const embedding = await generateNodeEmbedding(
              existingNode.name,
              existingNode.description,
              updatedNotes
            );

            // Update node with new notes and embedding
            updatedNode = await entityRepository.update({
              entity_key,
              notes: updatedNotes,
              embedding,
              last_update_source: sourceEntityKey,
              confidence: 0.9,
            });

            nodeName = updatedNode.name;
            break;
          }

          default:
            return JSON.stringify({
              success: false,
              error: `Unsupported node type: ${nodeType}`,
            });
        }

        return JSON.stringify({
          success: true,
          entity_key,
          node_type: inferredNodeType,
          message: `Added ${notes.length} note(s) to ${inferredNodeType} node: ${nodeName}`,
          notes_added: notes.length,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: errorMessage,
        });
      }
    },
  });
}

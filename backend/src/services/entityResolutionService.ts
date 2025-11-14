/**
 * Entity Resolution Service
 *
 * Determines whether extracted entities match existing nodes in the knowledge graph
 * using multi-tier matching (exact, fuzzy, embedding-based) with LLM arbitration.
 *
 * Reference: backend/docs/entity-resolution-implementation-plan.md
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { neo4jService } from '../db/neo4j.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { Entity } from '../types/graph.js';
import { generateEmbedding } from './embeddingGenerationService.js';
import { createRelationshipTool } from '../agents/tools/relationships/relationship.tool.js';
import {
  ENTITY_RESOLUTION_SYSTEM_PROMPT,
  NODE_CREATION_SYSTEM_PROMPT,
  NEW_ENTITY_EXTRACTION_PROMPT,
} from '../agents/prompts/ingestion/resolution.js';

/**
 * Extracted entity from Phase 1
 */
export interface ExtractedEntity {
  name: string;
  entity_type: 'Person' | 'Concept' | 'Entity';
  confidence: number;
  subpoints?: string[];
  canonical_name?: string;
  description?: string;
}

/**
 * Entity with resolution result
 */
export interface ResolvedEntity extends ExtractedEntity {
  embedding: number[];
  resolved: boolean;
  entity_key?: string;
  resolution_reason: string;
}

/**
 * Schema for LLM resolution output
 *
 * OpenAI's structured output requires all fields to be in 'required' array,
 * so we make entity_key required but allow empty string when not resolved.
 */
const EntityResolutionSchema = z.object({
  resolved: z.boolean().describe('Whether extracted entity matches existing node'),
  entity_key: z.string().describe('entity_key if resolved=true, empty string if resolved=false'),
  reason: z.string().max(500).describe('Explanation of resolution decision'),
});

/**
 * Schema for new entity structured extraction
 *
 * All fields required for OpenAI structured output.
 */
const NewEntitySchema = z.object({
  name: z.string().min(1).max(200).describe('Name of the entity'),
  description: z.string().min(10).max(1000).describe('Detailed description of the entity'),
  notes: z.array(z.string()).default([]).describe('Key points and context about the entity'),
});

/**
 * Neighbor match from similarity search
 */
interface NeighborMatch {
  entity_key: string;
  name: string;
  description: string;
  notes: string[];
  similarity_score: number;
}

/**
 * Entity Resolution Service
 *
 * Main orchestrator for entity resolution pipeline
 */
export class EntityResolutionService {
  private llm: ChatOpenAI;

  constructor(_openai: unknown, llm: ChatOpenAI) {
    this.llm = llm;
  }

  /**
   * Main entry point: Resolve all extracted entities
   *
   * Orchestrates the full entity resolution pipeline:
   * 1. Generate embeddings for all extracted entities
   * 2. For each entity: find candidates + LLM resolution
   * 3. Execute update path for resolved entities
   * 4. Execute create path for new entities
   *
   * Returns resolved and unresolved entities with metadata.
   */
  async resolveEntities(
    userId: string,
    teamId: string,
    extractedEntities: ExtractedEntity[],
    sourceContent: string,
    sourceEntityKey: string
  ): Promise<{
    resolved: ResolvedEntity[];
    unresolved: ResolvedEntity[];
  }> {
    console.log(`\n🔍 Entity Resolution: Processing ${extractedEntities.length} entities...`);

    if (extractedEntities.length === 0) {
      return { resolved: [], unresolved: [] };
    }

    try {
      // Step 1: Generate embeddings for all extracted entities
      const entityEmbeddings = await this.generateEntityEmbeddings(extractedEntities);

      // Step 2: Resolve each entity (find candidates + LLM decision)
      const resolvedEntities: ResolvedEntity[] = [];

      for (const { entity, embedding } of entityEmbeddings) {
        // Find candidates through multi-tier matching
        const candidates = await this.findResolutionCandidates(userId, entity, embedding);

        // LLM makes final resolution decision
        const resolution = await this.resolveWithLLM(entity, embedding, candidates);

        resolvedEntities.push({
          ...entity,
          embedding,
          resolved: resolution.resolved,
          entity_key: resolution.entity_key,
          resolution_reason: resolution.reason,
        });

        console.log(
          `   ${resolution.resolved ? '✅ Matched' : '🆕 New'}: ${entity.name} (${entity.entity_type})${resolution.resolved ? ` → ${resolution.entity_key}` : ''}`
        );
        console.log(`      Reason: ${resolution.reason}`);
      }

      // Step 3: Execute update or create actions
      // Update path for resolved entities
      for (const entity of resolvedEntities.filter((e) => e.resolved)) {
        if (entity.entity_key) {
          const newInformation = entity.description ? entity.description : 'New mention without additional description';
          await this.updateExistingNode(
            userId,
            entity.entity_key,
            newInformation,
            sourceContent,
            sourceEntityKey
          );
        }
      }

      // Create path for new entities
      for (const entity of resolvedEntities.filter((e) => !e.resolved)) {
        const newEntityKey = await this.createNewNode(userId, teamId, entity, sourceContent, sourceEntityKey);
        // Update entity_key on the resolved entity
        entity.entity_key = newEntityKey;
      }

      const resolved = resolvedEntities.filter((e) => e.resolved);
      const unresolved = resolvedEntities.filter((e) => !e.resolved);

      console.log(`✅ Entity Resolution Complete: ${resolved.length} updated, ${unresolved.length} created`);

      return { resolved, unresolved };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Entity resolution failed: ${errorMessage}`);
      throw new Error(`Entity resolution failed: ${errorMessage}`);
    }
  }

  /**
   * Generate embeddings for entities
   *
   * Creates embeddings for each extracted entity using OpenAI text-embedding-3-small.
   * Format: '${name} (${type})\n${subpoints.join('\n')}'
   */
  private async generateEntityEmbeddings(
    entities: ExtractedEntity[]
  ): Promise<Array<{ entity: ExtractedEntity; embedding: number[] }>> {
    console.log(`   Generating embeddings for ${entities.length} entities...`);

    try {
      // Prepare embedding inputs (name + type + subpoints)
      const embeddingInputs = entities.map((entity) => {
        const subpointsText = (entity.subpoints || []).join('\n');
        return `${entity.name} (${entity.entity_type})\n${subpointsText}`;
      });

      // Batch generate embeddings using OpenAI
      const embeddings = await Promise.all(
        embeddingInputs.map((input) => generateEmbedding(input))
      );

      // Map embeddings back to entities
      return entities.map((entity, idx) => ({
        entity,
        embedding: embeddings[idx],
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Failed to generate embeddings: ${errorMessage}`);
      throw new Error(`Embedding generation failed: ${errorMessage}`);
    }
  }

  /**
   * Find resolution candidates using multi-tier matching
   *
   * Calls repository methods for:
   * 1. Exact name + type match
   * 2. Fuzzy string matching (Levenshtein distance < 3)
   * 3. Embedding similarity search (cosine > 0.75, top-K=20)
   *
   * Returns deduplicated list of up to 20 candidates
   */
  private async findResolutionCandidates(
    userId: string,
    entity: ExtractedEntity,
    embedding: number[]
  ): Promise<
    Array<{
      entity_key: string;
      name: string;
      description?: string | null;
      similarity_score?: number;
    }>
  > {
    try {
      // Select appropriate repository based on entity type
      const repo =
        entity.entity_type === 'Person'
          ? personRepository
          : entity.entity_type === 'Concept'
            ? conceptRepository
            : entityRepository;

      // Run multi-tier matching in parallel
      const [exactMatch, fuzzyMatches, similarMatches] = await Promise.all([
        repo.findByExactMatch(userId, entity.name, entity.canonical_name, entity.entity_type),
        repo.findByFuzzyMatch(userId, entity.name, entity.entity_type, 3),
        repo.findByEmbeddingSimilarity(userId, embedding, entity.entity_type, 0.75, 20),
      ]);

      // Deduplicate and combine candidates (use repository method)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidates = (repo as any).deduplicateCandidates(
        exactMatch ? [exactMatch] : [],
        fuzzyMatches,
        similarMatches,
        20
      ) as Entity[];

      return candidates.map((c) => {
        const cWithScore = c as typeof c & { similarity_score?: number };
        return {
          entity_key: c.entity_key,
          name: c.name,
          description: c.description || null,
          similarity_score: cWithScore.similarity_score ?? undefined,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Failed to find candidates: ${errorMessage}`);
      // Return empty candidates on error (treat as new entity)
      return [];
    }
  }

  /**
   * LLM-based resolution (final arbiter)
   *
   * Uses GPT-4.1-mini with structured output to determine if the extracted entity
   * matches any of the candidate nodes from multi-tier matching.
   *
   * Conservative bias: When in doubt, mark as new entity.
   */
  private async resolveWithLLM(
    entity: ExtractedEntity,
    _embedding: number[],
    candidates: Array<{ entity_key: string; name: string; description?: string | null; similarity_score?: number }>
  ): Promise<{
    resolved: boolean;
    entity_key?: string;
    reason: string;
  }> {
    try {
      // Use structured output for consistent LLM response
      const resolutionModel = this.llm.withStructuredOutput(EntityResolutionSchema);

      const candidatesText =
        candidates.length > 0
          ? candidates
              .map(
                (c) =>
                  `- entity_key: ${c.entity_key}\n  name: ${c.name}\n  description: ${c.description || 'N/A'}${c.similarity_score ? `\n  similarity: ${(c.similarity_score * 100).toFixed(0)}%` : ''}`
              )
              .join('\n\n')
          : 'No candidates found';

      const resolution = await resolutionModel.invoke([
        new SystemMessage(ENTITY_RESOLUTION_SYSTEM_PROMPT),
        new HumanMessage(`## Extracted Entity
Name: ${entity.name}
Type: ${entity.entity_type}
Description: ${entity.description || 'No description'}
Subpoints: ${(entity.subpoints || []).join('\n') || 'None'}

## Candidate Nodes (0-${candidates.length})
${candidatesText}

## Task
Determine if the extracted entity matches any existing node. Return { resolved: true, entity_key: "...", reason: "..." } if match found, or { resolved: false, reason: "..." } if new entity.`),
      ]);

      return {
        resolved: resolution.resolved,
        entity_key: resolution.entity_key || undefined, // Convert empty string to undefined
        reason: resolution.reason,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ LLM resolution failed: ${errorMessage}`);
      // Default to "new entity" on error
      return {
        resolved: false,
        reason: `LLM resolution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Update existing node (for resolved entities)
   *
   * Uses agent-based additive update with NODE_UPDATE_SYSTEM_PROMPT.
   * Agent only has access to update_node and update_edge tools.
   * After update, regenerates node embeddings.
   */
  async updateExistingNode(
    userId: string,
    entity_key: string,
    newInformation: string,
    _sourceContent: string,
    sourceEntityKey: string
  ): Promise<void> {
    console.log(`   📝 Updating existing node: ${entity_key}`);

    try {
      // Load existing node with neighbors
      const result = await neo4jService.executeQuery<{
        node: {
          entity_key: string;
          name: string;
          description: string;
          notes: string;
        };
        neighbors: Array<{
          name: string;
          description: string;
          notes: string;
        }>;
      }>(
        `
        MATCH (n {entity_key: $entity_key})
        WITH n,
             [(n)-[r]-(m) |
              {name: m.name, description: coalesce(m.description, ''), notes: coalesce(m.notes, [])}] AS neighbors
        RETURN n {.entity_key, .name, .description, .notes} AS node,
               neighbors
        `,
        { entity_key }
      );

      if (result.length === 0) {
        throw new Error(`Node with entity_key ${entity_key} not found`);
      }

      const { node } = result[0];

      // For now, perform simple additive update by adding a note
      // TODO: Wire up agent with update_node and update_edge tools
      console.log(`   Adding note to node based on: ${newInformation.substring(0, 100)}...`);

      // Parse existing notes if they're JSON
      let existingNotes: Array<{
        content: string;
        added_by: string;
        source_entity_key: string;
        date_added: string;
        expires_at: string | null;
      }> = [];

      if (node.notes) {
        try {
          const parsed = JSON.parse(node.notes);
          if (Array.isArray(parsed)) {
            existingNotes = parsed;
          }
        } catch (e) {
          console.warn(`Failed to parse notes for node ${entity_key}, treating as empty`);
        }
      }

      // Add new note
      const newNote = {
        content: newInformation,
        added_by: userId,
        source_entity_key: sourceEntityKey,
        date_added: new Date().toISOString(),
        expires_at: null,
      };

      existingNotes.push(newNote);

      // Simple additive update
      await neo4jService.executeQuery(
        `
        MATCH (n {entity_key: $entity_key})
        SET n.notes = $notes,
            n.updated_at = datetime(),
            n.last_update_source = $source_entity_key
        `,
        {
          entity_key,
          notes: JSON.stringify(existingNotes),
          source_entity_key: sourceEntityKey,
        }
      );

      // Regenerate embeddings
      await this.regenerateNodeEmbeddings(entity_key);

      console.log(`   ✅ Node updated successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Failed to update node: ${errorMessage}`);
      throw new Error(`Node update failed: ${errorMessage}`);
    }
  }

  /**
   * Create new node (for unresolved entities)
   *
   * Phase 4: New Node Path Implementation
   * 1. Structured extraction for new entity (LLM)
   * 2. Generate node embedding
   * 3. Create node in Neo4j
   * 4. Find top-K neighbors (similarity search)
   * 5. Create relationship agent to connect to neighbors
   * 6. Return entity_key
   */
  async createNewNode(
    userId: string,
    teamId: string,
    entity: ResolvedEntity,
    sourceContent: string,
    sourceEntityKey: string
  ): Promise<string> {
    try {
      console.log(`[EntityResolution] Creating new node for: ${entity.name} (${entity.entity_type})`);

      // Step 1: Structured extraction for new entity
      const extractionModel = this.llm.withStructuredOutput(NewEntitySchema);
      const newEntity = await extractionModel.invoke([
        new SystemMessage(NEW_ENTITY_EXTRACTION_PROMPT),
        new HumanMessage(`
Name: ${entity.name}
Type: ${entity.entity_type}
Context: ${entity.description || 'No additional context'}
        `),
      ]);

      console.log(`[EntityResolution] Extracted structured data:`, newEntity);

      // Step 2: Generate node embedding
      const embeddingInput = `${newEntity.name}\n${newEntity.description}\n${(newEntity.notes || []).join('\n')}`;
      const nodeEmbedding = await generateEmbedding(embeddingInput);

      console.log(`[EntityResolution] Generated embedding (dim: ${nodeEmbedding.length})`);

      // Step 3: Create node in Neo4j
      const newEntityKey = uuidv4();

      // Map entity_type to Neo4j node label
      const nodeLabel = entity.entity_type; // 'Person', 'Concept', or 'Entity'

      await neo4jService.executeQuery(
        `
        CREATE (n:${nodeLabel} {
          entity_key: $entity_key,
          name: $name,
          description: $description,
          notes: $notes,
          user_id: $user_id,
          team_id: $team_id,
          embedding: $embedding,
          created_at: datetime(),
          confidence: $confidence,
          salience: 0.5,
          state: 'candidate',
          created_by: $user_id,
          last_update_source: $source_entity_key
        })
        RETURN n.entity_key
        `,
        {
          entity_key: newEntityKey,
          name: newEntity.name,
          description: newEntity.description,
          notes: JSON.stringify(
            (newEntity.notes || []).map((note) => ({
              content: note,
              added_by: userId,
              source_entity_key: sourceEntityKey,
              date_added: new Date().toISOString(),
              expires_at: null, // Default notes don't expire
            }))
          ),
          user_id: userId,
          team_id: teamId,
          embedding: nodeEmbedding,
          confidence: entity.confidence,
          source_entity_key: sourceEntityKey,
        }
      );

      console.log(`[EntityResolution] Created ${nodeLabel} node: ${newEntityKey}`);

      // Step 4: Find top-K neighbors for edge creation context
      const neighbors = await neo4jService.executeQuery<{
        node: {
          entity_key: string;
          name: string;
          description: string;
          notes: string;
        };
        score: number;
      }>(
        `
        MATCH (n {user_id: $user_id})
        WHERE (n:${nodeLabel} OR n:Person OR n:Concept OR n:Entity)
          AND n.embedding IS NOT NULL
          AND n.entity_key <> $new_entity_key
        WITH n, gds.similarity.cosine(n.embedding, $embedding) AS score
        WHERE score > 0.6
        RETURN n {.entity_key, .name, .description, .notes} AS node, score
        ORDER BY score DESC
        LIMIT 5
        `,
        {
          user_id: userId,
          new_entity_key: newEntityKey,
          embedding: nodeEmbedding,
        }
      );

      console.log(`[EntityResolution] Found ${neighbors.length} similar neighbors`);

      // Parse notes JSON if present
      const neighborsWithParsedNotes: NeighborMatch[] = neighbors.map((n) => {
        let notes: string[] = [];
        try {
          if (n.node.notes) {
            const parsedNotes = JSON.parse(n.node.notes);
            notes = Array.isArray(parsedNotes) ? parsedNotes.map((note: any) => note.content || note) : [];
          }
        } catch (e) {
          // If notes aren't JSON, treat as empty
          notes = [];
        }

        return {
          entity_key: n.node.entity_key,
          name: n.node.name,
          description: n.node.description || '',
          notes,
          similarity_score: n.score,
        };
      });

      // Step 5: Create relationship agent to connect to neighbors
      if (neighborsWithParsedNotes.length > 0) {
        const createAgent = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
        const createMessages = [
          new SystemMessage(NODE_CREATION_SYSTEM_PROMPT),
          new HumanMessage(`
## New Node
Name: ${newEntity.name}
Type: ${entity.entity_type}
Description: ${newEntity.description}

## Similar Neighbors (consider creating edges)
${neighborsWithParsedNotes
  .map(
    (n) => `
- ${n.name} (similarity: ${(n.similarity_score * 100).toFixed(0)}%)
  entity_key: ${n.entity_key}
  Description: ${n.description}
  Notes: ${n.notes.slice(0, 3).join('; ') || 'N/A'}
`
  )
  .join('\n')}

## Original Source Content
${sourceContent.substring(0, 1000)}${sourceContent.length > 1000 ? '...' : ''}

## Task
Create edges between this node (entity_key: ${newEntityKey}) and similar neighbors if semantically related. Only use create_relationship tool.
          `),
        ];

        try {
          // Invoke agent with relationship creation tools
          await createAgent.invoke(createMessages, {
            tools: [createRelationshipTool],
          });

          console.log(`[EntityResolution] Relationship agent completed edge creation`);
        } catch (error) {
          console.error(`[EntityResolution] Error in relationship agent:`, error);
          // Don't fail the entire operation if edge creation fails
        }
      } else {
        console.log(`[EntityResolution] No neighbors found - skipping edge creation`);
      }

      // Step 6: Return entity_key
      return newEntityKey;
    } catch (error) {
      console.error(`[EntityResolution] Error creating new node:`, error);
      throw error;
    }
  }

  /**
   * Regenerate embeddings for a node after updates
   *
   * Loads node data (name, description, notes), generates new embedding,
   * and updates the node in Neo4j.
   */
  private async regenerateNodeEmbeddings(entity_key: string): Promise<number[]> {
    try {
      // Load node data
      const result = await neo4jService.executeQuery<{
        name: string;
        description: string;
        notes: string;
      }>(
        `
        MATCH (n {entity_key: $entity_key})
        RETURN n.name AS name,
               n.description AS description,
               n.notes AS notes
        `,
        { entity_key }
      );

      if (result.length === 0) {
        throw new Error(`Node ${entity_key} not found`);
      }

      const { name, description, notes } = result[0];

      // Parse notes to extract content
      let notesContent = '';
      if (notes) {
        try {
          const parsedNotes = JSON.parse(notes);
          if (Array.isArray(parsedNotes)) {
            notesContent = parsedNotes.map((note: { content?: string }) => note.content).filter(Boolean).join('\n');
          }
        } catch (e) {
          console.warn(`Failed to parse notes for embedding regeneration: ${entity_key}`);
        }
      }

      // Generate new embedding
      const embeddingInput = `${name}\n${description}\n${notesContent}`.trim();
      const newEmbedding = await generateEmbedding(embeddingInput);

      // Update node with new embedding
      await neo4jService.executeQuery(
        `
        MATCH (n {entity_key: $entity_key})
        SET n.embedding = $embedding,
            n.updated_at = datetime()
        `,
        { entity_key, embedding: newEmbedding }
      );

      return newEmbedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Failed to regenerate embeddings: ${errorMessage}`);
      throw new Error(`Embedding regeneration failed: ${errorMessage}`);
    }
  }
}

/**
 * Entity Resolution Service
 *
 * Determines whether extracted memories match existing nodes in the knowledge graph
 * using single-tier embedding similarity matching (threshold 0.6, top-10) with LLM decision.
 *
 * Phase 2: Simplified to use ONLY embedding similarity, parallel processing, MERGE/CREATE decisions.
 * Reference: INGESTION_REFACTOR_PLAN_V2.md Phase 2
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { RESOLUTION_DECISION_SYSTEM_PROMPT } from '../agents/prompts/ingestion/resolution-decision.js';
import { ResolutionDecisionSchema } from '../agents/schemas/ingestion.js';
import { neo4jService } from '../db/neo4j.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import type { EntityType, NoteObject } from '../types/graph.js';
import { buildNameToKeyMap, type NamedNeighbor } from '../utils/entityKeyHelpers.js';
import type { SourceSibling } from '../utils/neighborHelpers.js';
import { parseNotes } from '../utils/notes.js';
import { generateEmbedding } from './embeddingGenerationService.js';
import { formatNeighborsAsMarkdown } from '../utils/contextFormatting.js';
import {
  combineRankings,
  COMMON_BOOSTS,
  type RankingSignal,
} from '../utils/rrfScoring.js';

import type { ExtractedEntity } from '../types/ingestion.js';

/**
 * Entity with resolution result
 */
export interface ResolvedEntity extends ExtractedEntity {
  embedding: number[];
  resolved: boolean;
  entity_key?: string;
  resolution_reason: string;
}

// ResolutionDecisionSchema is imported from schemas/ingestion.ts

/**
 * Entity Resolution Service
 *
 * Main orchestrator for memory resolution pipeline
 */
export class EntityResolutionService {
  private modelId: string;

  constructor(
    _openai: unknown,
    _llm?: unknown,
    modelId: string = "gpt-5-nano"
  ) {
    this.modelId = modelId;
  }

  /**
   * Main entry point: Resolve all extracted memories
   *
   * Orchestrates the full memory resolution pipeline with SEQUENTIAL processing:
   * 1. Sort memories by confidence DESC (high confidence first)
   * 2. For each memory sequentially:
   *    a. Use embedding from Phase 1 (or generate if not present)
   *    b. Find top-k neighbors using embedding similarity (threshold 0.6, limit 10)
   *    c. LLM makes MERGE vs CREATE decision
   *    d. If CREATE: execute immediately (so new nodes are visible to later memories)
   *    e. If MERGE: queue for later parallel execution
   * 3. Execute all MERGE operations in parallel (they update existing nodes)
   *
   * Returns memories classified as MERGE or CREATE based on LLM decision.
   */
  async resolveEntities(
    userId: string,
    teamId: string,
    extractedEntities: ExtractedEntity[],
    sourceContent: string,
    sourceId: string
  ): Promise<{
    resolved: ResolvedEntity[];
    unresolved: ResolvedEntity[];
    totalRelationshipsCreated: number;
  }> {
    console.log(
      `\n🔍 Memory Resolution: Processing ${extractedEntities.length} memories sequentially (sorted by confidence DESC)...`
    );

    if (extractedEntities.length === 0) {
      return { resolved: [], unresolved: [], totalRelationshipsCreated: 0 };
    }

    try {
      // Sort entities by type priority (person → entity → concept), then by confidence DESC within each type
      const typePriority: Record<string, number> = {
        person: 0,
        entity: 1,
        concept: 2,
      };

      const sortedEntities = [...extractedEntities].sort((a, b) => {
        // First, sort by type priority
        const typeDiff =
          typePriority[a.entity_type] - typePriority[b.entity_type];
        if (typeDiff !== 0) return typeDiff;

        // Within same type, sort by confidence DESC (high confidence first)
        return b.confidence - a.confidence;
      });

      console.log(
        `   📊 Processing order (person → entity → concept, confidence DESC within type): ${sortedEntities
          .map(
            (e) =>
              `${e.name} (${e.entity_type}, ${(e.confidence * 100).toFixed(
                0
              )}%)`
          )
          .join(", ")}`
      );

      const resolvedEntities: ResolvedEntity[] = [];
      const unresolvedEntities: ResolvedEntity[] = [];
      let totalRelationshipsCreated = 0;

      // Queue for MERGE operations (will be executed in parallel later)
      const mergeOperations: Array<{
        entity: ExtractedEntity;
        embedding: number[];
        decision: {
          action: "MERGE";
          target_entity_key: string;
          reason: string;
        };
      }> = [];

      // NEW: Track all resolved entities from this source for sibling relationship creation
      // Accumulates as we process entities sequentially - entity N will see entities 1...N-1
      const sourceResolvedEntities: SourceSibling[] = [];

      // Process entities sequentially (one at a time)
      for (const entity of sortedEntities) {
        const entityStartTime = Date.now();
        try {
          // Use pre-generated embedding from Phase 1 (extraction phase)
          // Embeddings should already be present - throw error if missing
          if (!entity.embedding || entity.embedding.length === 0) {
            throw new Error(
              `Entity ${entity.name} (${entity.entity_type}) missing embedding. Embeddings must be generated during extraction phase (Phase 1).`
            );
          }

          const embedding = entity.embedding;

          // Find top-k neighbors using embedding similarity only
          const neighborStartTime = Date.now();
          const neighbors = await this.findResolutionCandidates(
            userId,
            entity,
            embedding
          );
          const neighborTimeMs = Date.now() - neighborStartTime;

          // LLM makes MERGE vs CREATE decision
          const decisionStartTime = Date.now();
          const decision = await this.resolveWithLLM(
            userId,
            entity,
            embedding,
            neighbors
          );
          const decisionTimeMs = Date.now() - decisionStartTime;

          console.log(
            `   ${decision.action === "MERGE" ? "✅ MERGE" : "🆕 CREATE"}: ${
              entity.name
            } (${entity.entity_type})${
              decision.action === "MERGE" && decision.target_entity_key
                ? ` → ${decision.target_entity_key}`
                : ""
            }`
          );
          console.log(`      Reason: ${decision.reason}`);
          console.log(`      ⏱️  Neighbor search: ${neighborTimeMs}ms, Decision: ${decisionTimeMs}ms`);

          if (decision.action === "MERGE" && decision.target_entity_key) {
            // Queue MERGE operation for later parallel execution
            mergeOperations.push({
              entity,
              embedding,
              decision: {
                action: "MERGE",
                target_entity_key: decision.target_entity_key,
                reason: decision.reason,
              },
            });

            // NEW: Track merged entity as source sibling for future entities
            sourceResolvedEntities.push({
              entity_key: decision.target_entity_key,
              name: entity.name,
              type: entity.entity_type,
            });

            const entityTotalTimeMs = Date.now() - entityStartTime;
            console.log(`      ⏱️  Total entity time: ${entityTotalTimeMs}ms\n`);
          } else {
            // CREATE: Execute immediately so new nodes are visible to later entities
            const resolvedEntity: ResolvedEntity = {
              ...entity,
              embedding,
              resolved: false,
              resolution_reason: decision.reason,
            };

            const createStartTime = Date.now();
            const createResult = await this.createNewNode(
              userId,
              teamId,
              resolvedEntity,
              sourceContent,
              sourceId,
              sourceResolvedEntities
            );
            const createTimeMs = Date.now() - createStartTime;

            // Track relationship count from create agent
            totalRelationshipsCreated += createResult.relationshipsCreated;

            // Update entity_key and track as unresolved (new)
            resolvedEntity.entity_key = createResult.entityKey;
            unresolvedEntities.push(resolvedEntity);

            // NEW: Track created entity as source sibling for future entities
            sourceResolvedEntities.push({
              entity_key: createResult.entityKey,
              name: entity.name,
              type: entity.entity_type,
            });

            const entityTotalTimeMs = Date.now() - entityStartTime;
            console.log(`      ⏱️  CREATE agent: ${createTimeMs}ms, Total: ${entityTotalTimeMs}ms\n`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `   ❌ Failed to process entity ${entity.name} (${entity.entity_type}): ${errorMessage}`
          );
          // Continue processing remaining entities
        }
      }

      // Execute all MERGE operations in parallel (they update existing nodes)
      if (mergeOperations.length > 0) {
        console.log(
          `\n   🔄 Executing ${mergeOperations.length} MERGE operations in parallel...`
        );
        const mergeStartTime = Date.now();
        const mergeResults = await Promise.allSettled(
          mergeOperations.map(async ({ entity, embedding, decision }) => {
            const mergeResult = await this.updateExistingNode(
              userId,
              decision.target_entity_key,
              entity,
              sourceContent,
              sourceId,
              sourceResolvedEntities // NEW: Pass source siblings
            );

            // Track relationship count from merge agent
            totalRelationshipsCreated += mergeResult.relationshipsCreated;

            // Track as resolved
            resolvedEntities.push({
              ...entity,
              embedding,
              resolved: true,
              entity_key: decision.target_entity_key,
              resolution_reason: decision.reason,
            });
          })
        );
        const mergeTimeMs = Date.now() - mergeStartTime;
        console.log(`   ⏱️  MERGE operations completed in ${mergeTimeMs}ms`);

        // Handle MERGE failures - log but continue
        mergeResults.forEach((result, index) => {
          if (result.status === "rejected") {
            const { entity } = mergeOperations[index];
            const errorMessage =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            console.error(
              `   ❌ Failed to MERGE entity ${entity.name} (${entity.entity_type}): ${errorMessage}`
            );
          }
        });
      }

      console.log(
        `✅ Memory Resolution Complete: ${resolvedEntities.length} MERGE, ${unresolvedEntities.length} CREATE, ${totalRelationshipsCreated} relationships created`
      );

      return {
        resolved: resolvedEntities,
        unresolved: unresolvedEntities,
        totalRelationshipsCreated,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Memory resolution failed: ${errorMessage}`);
      throw new Error(`Memory resolution failed: ${errorMessage}`);
    }
  }

  /**
   * Find resolution candidates using RRF (Reciprocal Rank Fusion) scoring
   *
   * Combines three ranking signals:
   * 1. Embedding similarity (cosine > 0.6)
   * 2. Exact name match (case-insensitive)
   * 3. Fuzzy name match (Levenshtein distance)
   *
   * RRF formula: score = 1/(k + rank_embedding) + 1/(k + rank_exact) + 1/(k + rank_fuzzy)
   * where k=60 (standard RRF constant)
   *
   * Returns up to 10 candidates sorted by RRF score DESC.
   *
   * Similarity score interpretation (0-1 range):
   * - Exact name match (rank 1): 90% minimum
   * - Fuzzy + embedding match: 70% minimum
   * - Fuzzy match only: 60% minimum
   * - All other matches: RRF score normalized to theoretical maximum (3/(k+1))
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
      similarity_score: number;
      entity_type: EntityType;
    }>
  > {
    try {
      // Select appropriate repository based on entity type
      const repo =
        entity.entity_type === "person"
          ? personRepository
          : entity.entity_type === "concept"
          ? conceptRepository
          : entityRepository;

      // Execute all three search strategies in parallel
      const [embeddingMatches, exactMatches, fuzzyMatches] = await Promise.all([
        repo.findByEmbeddingSimilarity(
          userId,
          embedding,
          entity.entity_type,
          0.6,
          20
        ),
        repo.findByExactMatchWithScore(userId, entity.name, 20),
        repo.findByFuzzyMatchWithScore(userId, entity.name, 20),
      ]);

      // Prepare ranking signals for RRF
      const signals: RankingSignal<{
        entity_key: string;
        name: string;
        description?: string | null;
        entity_type: EntityType;
      }>[] = [
        {
          name: 'embedding',
          results: embeddingMatches.map((m) => ({
            id: m.entity_key,
            data: {
              entity_key: m.entity_key,
              name: m.name,
              description: m.description,
              entity_type: entity.entity_type,
            },
            score: 'similarity_score' in m ? (m.similarity_score as number) : undefined,
          })),
        },
        {
          name: 'exact_match',
          results: exactMatches.map((m) => ({
            id: m.entity_key,
            data: {
              entity_key: m.entity_key,
              name: m.name,
              description: m.description,
              entity_type: entity.entity_type,
            },
            score: 'score' in m ? (m.score as number) : undefined,
          })),
        },
        {
          name: 'fuzzy_match',
          results: fuzzyMatches.map((m) => ({
            id: m.entity_key,
            data: {
              entity_key: m.entity_key,
              name: m.name,
              description: m.description,
              entity_type: entity.entity_type,
            },
            score: 'fuzzy_score' in m ? (m.fuzzy_score as number) : undefined,
          })),
        },
      ];

      // Combine rankings using RRF with signal-aware boosts
      const rrfResults = combineRankings(signals, {
        k: 60,
        topK: 10,
        boosts: [
          COMMON_BOOSTS.exactMatch,
          COMMON_BOOSTS.fuzzyAndEmbedding,
          COMMON_BOOSTS.fuzzyOnly,
        ],
      });

      // Convert to expected return format
      return rrfResults.map((r) => ({
        entity_key: r.data.entity_key,
        name: r.data.name,
        description: r.data.description,
        similarity_score: r.similarity,
        entity_type: r.data.entity_type,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`   ❌ Failed to find candidates: ${errorMessage}`);
      // Return empty candidates on error (treat as new entity)
      return [];
    }
  }

  /**
   * LLM-based resolution decision (MERGE vs CREATE)
   *
   * Uses AI SDK with structured output to decide whether the extracted memory
   * should MERGE with an existing node or CREATE a new one.
   *
   * Uses ResolutionDecisionSchema and RESOLUTION_DECISION_SYSTEM_PROMPT.
   * Presents truncated entity keys (last 8 chars) to LLM, then expands back to full keys.
   */
  private async resolveWithLLM(
    userId: string,
    entity: ExtractedEntity,
    _embedding: number[],
    neighbors: Array<{
      entity_key: string;
      name: string;
      description?: string | null;
      similarity_score: number;
      entity_type: EntityType;
    }>
  ): Promise<{
    action: "MERGE" | "CREATE";
    target_entity_key?: string;
    reason: string;
  }> {
    try {
      // SHORT-CIRCUIT: If no candidates exist, CREATE is the only option
      if (neighbors.length === 0) {
        console.log(`   ⚡ Short-circuit CREATE for ${entity.name} (0 candidates)`);
        return {
          action: "CREATE",
          reason: "No merge candidates found - CREATE is deterministic"
        };
      }

      // Create OpenAI provider instance
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // Prepare neighbors with normalized names for LLM
      const { neighbors: namedNeighbors, nameToKeyMap } =
        buildNameToKeyMap(neighbors);

      // Log neighbors for debugging
      console.log(`   📋 Neighbors for ${entity.name}:`);
      namedNeighbors.forEach((n: NamedNeighbor) => {
        console.log(
          `      - ${n.normalized_name}: ${n.display_name} (${(
            n.similarity_score * 100
          ).toFixed(0)}%)`
        );
      });

      // Format neighbors using formatNeighborsAsMarkdown utility
      // Use XML format with RRF-based ranking
      // Note: We exclude notes here because resolution candidates don't include them
      // The decision is based on name, description, and similarity score only
      const neighborsText =
        namedNeighbors.length > 0
          ? formatNeighborsAsMarkdown(
              namedNeighbors.map((n: NamedNeighbor) => {
                const original = neighbors.find(
                  (orig) => orig.name === n.display_name
                );

                return {
                  entity_key: original?.entity_key ?? n.normalized_name,
                  name: n.display_name,
                  description: n.description,
                  entity_type: entity.entity_type,
                  similarity_score: n.similarity_score,
                };
              }),
              {
                format: 'xml',
                includeDescription: true,
                includeNotes: false, // Notes not available in resolution candidates
                includeSimilarityScore: false, // We'll add it separately to the prompt
                includeEntityKey: false,
                includeNodeType: false, // We'll show type in extracted_entity tag
              }
            )
          : "No neighbors found";

      // Build similarity scores list for context
      const similarityScoresText = namedNeighbors
        .map(
          (n: NamedNeighbor) =>
            `- ${n.normalized_name}: ${(n.similarity_score * 100).toFixed(0)}% (RRF-based)`
        )
        .join("\n");

      // Use generateObject for resolution decision
      const { object: decisionResult } = await generateObject({
        model: openai(this.modelId),
        schema: ResolutionDecisionSchema,
        system: RESOLUTION_DECISION_SYSTEM_PROMPT,
        prompt: `For the given potential new entity, decide whether to MERGE with an existing node among the top neighbors or CREATE a new one.

## Potential new entity:
<extracted_entity title="${entity.name}" type="${entity.entity_type}">
${entity.description ? entity.description : "No description provided"}${
          entity.subpoints && entity.subpoints.length > 0
            ? `

**Key points**:
${entity.subpoints.map((sp) => `- ${sp}`).join("\n")}`
            : ""
        }
</extracted_entity>

## Closest Matches
Neighbors are ranked using Reciprocal Rank Fusion (RRF), combining:
1. Embedding similarity (semantic meaning)
2. Exact name match (case-insensitive)
3. Fuzzy name match (Levenshtein distance)

Similarity scores (100% = top-ranked, normalized relative to best match):
${similarityScoresText}

<top_neighbors>
${neighborsText}
</top_neighbors>

## Task
If the potential new entity is similar to an existing node, MERGE with it. If it is not similar to any existing node, CREATE a new one. Return:
- Action: "MERGE" | "CREATE"
- Target Entity Name: string | null  // the normalized_name (e.g., "roy", "self_acceptance") if action=MERGE, null if action=CREATE
- Reason: string  // Brief explanation (1 sentence)

High similarity scores (>70%) indicate strong matches. Lower scores may still be valid if the semantic meaning aligns.`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'ingestion-resolution-decision',
          metadata: {
            userId,
            phase: 'resolution',
            entityType: entity.entity_type,
            candidateCount: namedNeighbors.length,
            schemaName: 'ResolutionDecisionSchema',
          },
        },
      });

      const decision = decisionResult as z.infer<
        typeof ResolutionDecisionSchema
      >;

      // Resolve normalized name back to full entity_key
      const fullEntityKey = decision.target_entity_key
        ? nameToKeyMap.get(decision.target_entity_key)
        : null;

      // Validate MERGE decision
      if (decision.action === "MERGE") {
        if (!decision.target_entity_key) {
          throw new Error(
            "MERGE decision requires target_entity_key (normalized_name) to be set"
          );
        }
        if (!fullEntityKey) {
          console.warn(
            `   ⚠️  LLM returned invalid normalized name: ${decision.target_entity_key}`
          );
          console.log(
            `   📋 Valid names: ${Array.from(nameToKeyMap.keys()).join(", ")}`
          );
          throw new Error(
            `Invalid target_entity_key: ${decision.target_entity_key} not found in candidates`
          );
        }
      }

      // Log decision
      console.log(
        `   🔍 Decision for ${entity.name}: ${decision.action}${
          fullEntityKey ? ` → ${fullEntityKey.slice(-8)}` : ""
        }`
      );
      console.log(`      Reason: ${decision.reason}`);

      return {
        action: decision.action,
        target_entity_key: fullEntityKey ?? undefined,
        reason: decision.reason,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`   ❌ LLM resolution decision failed: ${errorMessage}`);
      // Default to CREATE on error
      return {
        action: "CREATE",
        reason: `LLM resolution decision failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Update existing node (for resolved memories)
   *
   * Uses MERGE agent (AI SDK) to update existing nodes with new information.
   * The agent has access to update_node and update_edge tools.
   * After agent completes, regenerates node embeddings.
   *
   * Phase 5: Extracted MERGE logic into separate mergeAgent.ts
   *
   * @param sourceSiblings - Entities already resolved from this source (for sibling relationships)
   * @returns Relationship count from merge agent
   */
  async updateExistingNode(
    userId: string,
    entity_key: string,
    entity: ExtractedEntity,
    sourceContent: string,
    sourceId: string,
    sourceSiblings?: SourceSibling[]
  ): Promise<{ relationshipsCreated: number }> {
    console.log(`   📝 Updating existing node: ${entity_key}`);

    try {
      // Import merge agent (dynamic import to avoid circular dependencies)
      const { runMergeAgent } = await import("../agents/mergeAgent.js");

      // Run the merge agent with full extracted entity information
      const result = await runMergeAgent({
        userId,
        sourceEntityKey: sourceId,
        targetEntityKey: entity_key,
        sourceContent,
        extractedEntity: {
          name: entity.name,
          description: entity.description,
          subpoints: entity.subpoints || [],
        },
        sourceSiblings,
      });

      if (!result.success) {
        throw new Error(result.error || "Merge agent failed");
      }

      // Regenerate embeddings after agent updates
      await this.regenerateNodeEmbeddings(entity_key);

      console.log(
        `   ✅ Node updated successfully (${result.relationshipsCreated} relationships created)`
      );

      return { relationshipsCreated: result.relationshipsCreated };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`   ❌ Failed to update node: ${errorMessage}`);
      throw new Error(`Node update failed: ${errorMessage}`);
    }
  }

  /**
   * Create new node (for unresolved memories)
   *
   * Uses CREATE agent (AI SDK) to handle both node creation and relationship creation.
   * Phase 6-7: Extracted CREATE logic into separate createAgent.ts
   *
   * @param userId - User ID for node creation
   * @param teamId - Team ID (unused, kept for interface compatibility)
   * @param entity - Resolved memory to create
   * @param sourceContent - Full conversation transcript (markdown formatted)
   * @param sourceId - Source entity key for provenance tracking
   * @param sourceSiblings - Entities already resolved from this source (for sibling relationships)
   * @returns Created node entity_key and relationship count
   */
  async createNewNode(
    userId: string,
    _teamId: string,
    entity: ResolvedEntity,
    sourceContent: string,
    sourceId: string,
    sourceSiblings?: SourceSibling[]
  ): Promise<{ entityKey: string; relationshipsCreated: number }> {
    try {
      console.log(
        `[EntityResolution] Creating new node for: ${entity.name} (${entity.entity_type})`
      );

      // Convert ResolvedEntity to ExtractedEntity format for createAgent
      // ResolvedEntity has embedding from Phase 1, which createAgent expects
      if (!entity.description) {
        throw new Error(`Entity ${entity.name} missing required description`);
      }

      const extractedEntity: ExtractedEntity = {
        name: entity.name,
        entity_type: entity.entity_type,
        description: entity.description,
        subpoints: entity.subpoints ?? [],
        confidence: entity.confidence,
        embedding: entity.embedding, // Embedding should already be present from Phase 1
      };

      // Import and call create agent (dynamic import to avoid circular dependencies)
      const { runCreateAgent } = await import("../agents/createAgent.js");

      const result = await runCreateAgent(
        extractedEntity,
        sourceContent,
        userId,
        sourceId,
        sourceSiblings, // NEW: Pass source siblings
        this.modelId
      );

      // Regenerate embeddings after agent completes (to include notes added during Phase 1)
      await this.regenerateNodeEmbeddings(result.entityKey);

      console.log(
        `[EntityResolution] CREATE agent completed: ${result.entityKey} (${result.relationshipsCreated} relationships created)`
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[EntityResolution] Failed to create node: ${errorMessage}`
      );
      throw new Error(`Node creation failed: ${errorMessage}`);
    }
  }

  /**
   * Regenerate embeddings for a node after updates
   *
   * Loads node data (name, description, notes), generates new embedding,
   * and updates the node in Neo4j.
   */
  private async regenerateNodeEmbeddings(
    entity_key: string
  ): Promise<number[]> {
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

      const notesContent = parseNotes(notes)
        .map((note: NoteObject) => note.content)
        .filter(Boolean)
        .join("\n");

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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`   ❌ Failed to regenerate embeddings: ${errorMessage}`);
      throw new Error(`Embedding regeneration failed: ${errorMessage}`);
    }
  }
}

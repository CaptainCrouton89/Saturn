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
import {
  RelationshipGenerationService,
  type NodeForRelationships,
} from './relationshipGenerationService.js';

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
 * Resolution decision with cached neighbors
 */
export interface ResolutionDecision {
  entity: ExtractedEntity;
  embedding: number[];
  action: 'MERGE' | 'CREATE';
  target_entity_key?: string;
  reason: string;
  neighbors: Array<{
    entity_key: string;
    name: string;
    description?: string | null;
    similarity_score: number;
    entity_type: EntityType;
  }>;
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
   * Parallel decision pass: Run candidate search and LLM decisions in parallel
   *
   * This pass runs concurrently for all entities, caching neighbor data needed
   * for later phases. Failures default to CREATE decisions.
   *
   * @param userId User ID for search scoping
   * @param extractedEntities Entities to resolve
   * @param concurrencyLimit Maximum parallel operations (default: 5)
   * @returns Array of resolution decisions with cached neighbors
   */
  private async runDecisionPass(
    userId: string,
    extractedEntities: ExtractedEntity[],
    concurrencyLimit: number = 5
  ): Promise<ResolutionDecision[]> {
    console.log(`   🔍 Decision Pass: Processing ${extractedEntities.length} entities in parallel (concurrency: ${concurrencyLimit})...`);

    const decisions: ResolutionDecision[] = [];

    // Process in batches to respect concurrency limit
    for (let i = 0; i < extractedEntities.length; i += concurrencyLimit) {
      const batch = extractedEntities.slice(i, i + concurrencyLimit);

      const batchResults = await Promise.allSettled(
        batch.map(async (entity) => {
          const entityStartTime = Date.now();

          // Validate embedding exists
          if (!entity.embedding || entity.embedding.length === 0) {
            throw new Error(
              `Entity ${entity.name} (${entity.entity_type}) missing embedding`
            );
          }

          const embedding = entity.embedding;

          // Find candidates
          const neighbors = await this.findResolutionCandidates(
            userId,
            entity,
            embedding
          );

          // LLM decision
          const decision = await this.resolveWithLLM(
            userId,
            entity,
            embedding,
            neighbors
          );

          const totalTimeMs = Date.now() - entityStartTime;

          console.log(
            `   ${decision.action === "MERGE" ? "✅ MERGE" : "🆕 CREATE"}: ${
              entity.name
            } (${entity.entity_type})${
              decision.action === "MERGE" && decision.target_entity_key
                ? ` → ${decision.target_entity_key.slice(-8)}`
                : ""
            } [${totalTimeMs}ms]`
          );

          return {
            entity,
            embedding,
            action: decision.action,
            target_entity_key: decision.target_entity_key,
            reason: decision.reason,
            neighbors, // Cache neighbors for later phases
          } as ResolutionDecision;
        })
      );

      // Handle results - failures default to CREATE
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const entity = batch[j];

        if (result.status === 'fulfilled') {
          decisions.push(result.value);
        } else {
          // Failure: default to CREATE
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.error(
            `   ❌ Decision failed for ${entity.name} (${entity.entity_type}): ${errorMessage} - defaulting to CREATE`
          );
          decisions.push({
            entity,
            embedding: entity.embedding,
            action: 'CREATE',
            target_entity_key: undefined,
            reason: `Decision failed: ${errorMessage}`,
            neighbors: [],
          });
        }
      }
    }

    console.log(`   ✅ Decision Pass Complete: ${decisions.filter(d => d.action === 'MERGE').length} MERGE, ${decisions.filter(d => d.action === 'CREATE').length} CREATE`);
    return decisions;
  }

  /**
   * Main entry point: Resolve all extracted memories
   *
   * Orchestrates the full memory resolution pipeline with PARALLEL decision making:
   * 1. Sort memories by confidence DESC (high confidence first)
   * 2. Run parallel decision pass (LLM decisions + neighbor caching)
   * 3. Execute CREATE operations sequentially (so new nodes are visible to later relationships)
   * 4. Execute MERGE operations in parallel (they update existing nodes)
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
    timings: {
      decisionPassMs: number;
      nodeExecutionMs: number;
      relationshipGenerationMs: number;
    };
  }> {
    console.log(
      `\n🔍 Memory Resolution: Processing ${extractedEntities.length} memories with parallel decision pass...`
    );

    if (extractedEntities.length === 0) {
      return {
        resolved: [],
        unresolved: [],
        totalRelationshipsCreated: 0,
        timings: {
          decisionPassMs: 0,
          nodeExecutionMs: 0,
          relationshipGenerationMs: 0,
        },
      };
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

      // ============================================================================
      // Phase 1: Parallel Decision Pass
      // ============================================================================
      const decisionStartTime = Date.now();
      const decisions = await this.runDecisionPass(userId, sortedEntities);
      const decisionTimeMs = Date.now() - decisionStartTime;
      console.log(`   ⏱️  Decision pass completed in ${decisionTimeMs}ms`);

      const resolvedEntities: ResolvedEntity[] = [];
      const unresolvedEntities: ResolvedEntity[] = [];
      let totalRelationshipsCreated = 0;

      // Track all resolved entities from this source for sibling relationship creation
      const sourceResolvedEntities: SourceSibling[] = [];

      // Separate CREATE and MERGE decisions
      const createDecisions = decisions.filter(d => d.action === 'CREATE');
      const mergeDecisions = decisions.filter(d => d.action === 'MERGE');

      // Track nodes for relationship generation
      const nodesForRelationships: NodeForRelationships[] = [];

      // Track phase timings
      let nodeExecutionMs = 0;
      let relationshipGenerationMs = 0;

      // ============================================================================
      // Phase 2: Execute CREATE Operations (Sequential - nodes must exist for later phases)
      // ============================================================================
      const nodeExecutionStartTime = Date.now();

      if (createDecisions.length > 0) {
        console.log(
          `\n   🆕 Executing ${createDecisions.length} CREATE operations sequentially...`
        );
        const createStartTime = Date.now();

        for (const decision of createDecisions) {
          try {
            const resolvedEntity: ResolvedEntity = {
              ...decision.entity,
              embedding: decision.embedding,
              resolved: false,
              resolution_reason: decision.reason,
            };

            const createResult = await this.createNewNode(
              userId,
              teamId,
              resolvedEntity,
              sourceContent,
              sourceId,
              sourceResolvedEntities
            );

            // Update entity_key and track as unresolved (new)
            resolvedEntity.entity_key = createResult.entityKey;
            unresolvedEntities.push(resolvedEntity);

            // Track created entity as source sibling
            sourceResolvedEntities.push({
              entity_key: createResult.entityKey,
              name: decision.entity.name,
              type: decision.entity.entity_type,
            });

            // Add to relationship generation queue
            nodesForRelationships.push({
              entity_key: createResult.entityKey,
              entity: decision.entity,
              is_new: true,
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `   ❌ Failed to CREATE entity ${decision.entity.name} (${decision.entity.entity_type}): ${errorMessage}`
            );
            // Continue processing remaining entities
          }
        }

        const createTimeMs = Date.now() - createStartTime;
        console.log(`   ⏱️  CREATE operations completed in ${createTimeMs}ms`);
      }

      // ============================================================================
      // Phase 3: Execute MERGE Operations (Parallel - updates existing nodes)
      // ============================================================================
      if (mergeDecisions.length > 0) {
        console.log(
          `\n   🔄 Executing ${mergeDecisions.length} MERGE operations in parallel...`
        );
        const mergeStartTime = Date.now();

        // Add all merge targets to source siblings immediately (they're already resolved)
        for (const decision of mergeDecisions) {
          if (decision.target_entity_key) {
            sourceResolvedEntities.push({
              entity_key: decision.target_entity_key,
              name: decision.entity.name,
              type: decision.entity.entity_type,
            });
          }
        }

        const mergeResults = await Promise.allSettled(
          mergeDecisions.map(async (decision) => {
            if (!decision.target_entity_key) {
              throw new Error('MERGE decision missing target_entity_key');
            }

            await this.updateExistingNode(
              userId,
              decision.target_entity_key,
              decision.entity,
              sourceContent,
              sourceId,
              sourceResolvedEntities
            );

            // Track as resolved
            resolvedEntities.push({
              ...decision.entity,
              embedding: decision.embedding,
              resolved: true,
              entity_key: decision.target_entity_key,
              resolution_reason: decision.reason,
            });

            // Add to relationship generation queue
            nodesForRelationships.push({
              entity_key: decision.target_entity_key,
              entity: decision.entity,
              is_new: false,
            });
          })
        );

        const mergeTimeMs = Date.now() - mergeStartTime;
        console.log(`   ⏱️  MERGE operations completed in ${mergeTimeMs}ms`);

        // Handle MERGE failures - log but continue
        mergeResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            const decision = mergeDecisions[index];
            const errorMessage =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
            console.error(
              `   ❌ Failed to MERGE entity ${decision.entity.name} (${decision.entity.entity_type}): ${errorMessage}`
            );
          }
        });
      }

      nodeExecutionMs = Date.now() - nodeExecutionStartTime;

      // ============================================================================
      // Phase 4: Generate Relationships (Parallel - all nodes now exist)
      // ============================================================================
      if (nodesForRelationships.length > 0) {
        console.log(
          `\n   🔗 Generating relationships for ${nodesForRelationships.length} nodes in parallel...`
        );
        const relationshipStartTime = Date.now();

        const relationshipService = new RelationshipGenerationService(
          this.modelId
        );

        const relationshipResults = await relationshipService.generateRelationships(
          userId,
          sourceId,
          sourceContent,
          nodesForRelationships,
          sourceResolvedEntities,
          5 // concurrency limit
        );

        totalRelationshipsCreated = relationshipResults.totalRelationshipsCreated;

        relationshipGenerationMs = Date.now() - relationshipStartTime;
        console.log(
          `   ⏱️  Relationship generation completed in ${relationshipGenerationMs}ms`
        );
      }

      console.log(
        `✅ Memory Resolution Complete: ${resolvedEntities.length} MERGE, ${unresolvedEntities.length} CREATE, ${totalRelationshipsCreated} relationships created`
      );
      console.log(
        `   ⏱️  Timing breakdown: Decision=${decisionTimeMs}ms, Nodes=${nodeExecutionMs}ms, Relationships=${relationshipGenerationMs}ms`
      );

      return {
        resolved: resolvedEntities,
        unresolved: unresolvedEntities,
        totalRelationshipsCreated,
        timings: {
          decisionPassMs: decisionTimeMs,
          nodeExecutionMs,
          relationshipGenerationMs,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
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
   * Update existing node (for resolved memories) - Phase 1 only
   *
   * Uses MERGE agent Phase 1 to update node with new notes.
   * Relationships will be created in a separate pass.
   * After agent completes, regenerates node embeddings.
   */
  async updateExistingNode(
    userId: string,
    entity_key: string,
    entity: ExtractedEntity,
    sourceContent: string,
    sourceId: string,
    _sourceSiblings?: SourceSibling[]
  ): Promise<{ relationshipsCreated: number }> {
    try {
      // Import merge agent (dynamic import to avoid circular dependencies)
      const { runMergeAgentPhase1Only } = await import("../agents/mergeAgent.js");

      // Run Phase 1 only: update node with notes (no relationships)
      const result = await runMergeAgentPhase1Only(
        entity_key,
        sourceContent,
        {
          name: entity.name,
          description: entity.description,
          subpoints: entity.subpoints || [],
        },
        userId,
        sourceId
      );

      if (!result.success) {
        throw new Error(result.error || "Merge agent Phase 1 failed");
      }

      // Regenerate embeddings after agent updates
      await this.regenerateNodeEmbeddings(entity_key);

      return { relationshipsCreated: 0 }; // Relationships created in separate pass
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`   ❌ Failed to update node: ${errorMessage}`);
      throw new Error(`Node update failed: ${errorMessage}`);
    }
  }

  /**
   * Create new node (for unresolved memories) - Phase 1 only
   *
   * Uses CREATE agent Phase 1 to create node with structured data.
   * Relationships will be created in a separate pass.
   *
   * @param userId - User ID for node creation
   * @param teamId - Team ID (unused, kept for interface compatibility)
   * @param entity - Resolved memory to create
   * @param sourceContent - Full conversation transcript (markdown formatted)
   * @param sourceId - Source entity key for provenance tracking
   * @param sourceSiblings - Entities already resolved from this source (unused in Phase 1)
   * @returns Created node entity_key
   */
  async createNewNode(
    userId: string,
    _teamId: string,
    entity: ResolvedEntity,
    sourceContent: string,
    sourceId: string,
    _sourceSiblings?: SourceSibling[]
  ): Promise<{ entityKey: string; relationshipsCreated: number }> {
    try {
      // Convert ResolvedEntity to ExtractedEntity format for createAgent
      if (!entity.description) {
        throw new Error(`Entity ${entity.name} missing required description`);
      }

      const extractedEntity: ExtractedEntity = {
        name: entity.name,
        entity_type: entity.entity_type,
        description: entity.description,
        subpoints: entity.subpoints ?? [],
        confidence: entity.confidence,
        embedding: entity.embedding,
      };

      // Import and call create agent Phase 1 only (dynamic import to avoid circular dependencies)
      const { runCreateAgentPhase1Only } = await import("../agents/createAgent.js");

      const entityKey = await runCreateAgentPhase1Only(
        extractedEntity,
        sourceContent,
        userId,
        sourceId,
        this.modelId
      );

      // Regenerate embeddings after node creation (to include notes added during Phase 1)
      await this.regenerateNodeEmbeddings(entityKey);

      return { entityKey, relationshipsCreated: 0 }; // Relationships created in separate pass
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

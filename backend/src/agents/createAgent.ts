/**
 * CREATE Agent for Ingestion Pipeline
 *
 * Handles creation of new nodes and their relationships in two phases:
 * Phase 1: Structured node creation (Person, Concept, Entity)
 * Phase 2: Relationship creation to top neighbors
 *
 * Reference: INGESTION_REFACTOR_PLAN_V2.md Sections 2.5 and 2.6
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { eventRepository } from '../repositories/EventRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import type { EntityType, NoteObject, SemanticNeighbor } from '../types/graph.js';
import type { ExtractedEntity } from '../types/ingestion.js';
import { calculateDynamicMaxSteps } from '../utils/agentHelpers.js';
import { normalizeEntityName } from '../utils/entityKeyHelpers.js';
import { buildNeighborContext } from '../utils/neighborContextHelpers.js';
import { mergeNeighborsWithSourceSiblings, type SourceSibling } from '../utils/neighborHelpers.js';
import { getExpiresAt, loadNodeByEntityKey, loadSourceByEntityKey } from '../utils/nodeHelpers.js';
import {
  CREATE_CONCEPT_STRUCTURED_PROMPT,
  CREATE_ENTITY_STRUCTURED_PROMPT,
  CREATE_EVENT_STRUCTURED_PROMPT,
  CREATE_PERSON_STRUCTURED_PROMPT
} from './prompts/ingestion/create.js';
import { CREATE_RELATIONSHIPS_SYSTEM_PROMPT } from './prompts/ingestion/relationships.js';
import { NewEntitySchema, type NewEntity } from './schemas/ingestion.js';
import { createEdgeTool, updateNodeTool } from './tools/factories/index.js';

/**
 * Phase 1 only: Create structured node without relationships
 *
 * Creates the node using generateObject and returns the entity_key.
 * Relationships will be created in a separate pass.
 *
 * @param extractedEntity - Entity extracted from conversation
 * @param sourceContent - Full conversation transcript (markdown formatted)
 * @param userId - User ID for node creation
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param modelName - Model name for agent execution
 * @returns Created node entity_key
 */
export async function runCreateAgentPhase1Only(
  extractedEntity: ExtractedEntity,
  sourceContent: string,
  userId: string,
  sourceEntityKey: string,
  modelName: string = 'gpt-5-nano'
): Promise<string> {
  console.log(`   🆕 CREATE (Phase 1): Creating new ${extractedEntity.entity_type} node "${extractedEntity.name}"`);

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ============================================================================
  // Phase 1: Structured Node Creation
  // ============================================================================
  console.log(`      Generating structured node representation...`);

  // Select appropriate system prompt based on entity type
  const systemPrompt =
    extractedEntity.entity_type === 'person' ? CREATE_PERSON_STRUCTURED_PROMPT :
    extractedEntity.entity_type === 'concept' ? CREATE_CONCEPT_STRUCTURED_PROMPT :
    extractedEntity.entity_type === 'event' ? CREATE_EVENT_STRUCTURED_PROMPT :
    CREATE_ENTITY_STRUCTURED_PROMPT;

  const phase1Prompt = `
## Extracted Entity
- **Name**: ${extractedEntity.name}

## Source Content
${sourceContent}
`;

  const result = await generateObject({
    model: openai(modelName, {
      reasoningEffort: 'medium', // Use low reasoning for faster execution
    }),
    schema: NewEntitySchema,
    system: systemPrompt,
    prompt: phase1Prompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: `ingestion-phase1-create-structured-${extractedEntity.entity_type}`,
      metadata: {
        userId,
        sourceEntityKey,
        phase: 'phase1-create-structured',
        entityType: extractedEntity.entity_type,
        schemaName: 'NewEntitySchema',
      },
    },
  });

  const structuredOutput = result.object as NewEntity;

  // Load source node to get started_at timestamp
  const sourceNode = await loadSourceByEntityKey(sourceEntityKey);
  if (!sourceNode) {
    throw new Error(`Failed to fetch Source node with key ${sourceEntityKey}`);
  }
  if (!sourceNode.started_at) {
    throw new Error(
      `Source node ${sourceEntityKey} missing required 'started_at' property`
    );
  }

  // Extract started_at from source node
  const sourceStartedAt = sourceNode.started_at;

  // Convert structured output notes to NoteObject format with provenance
  const notes: NoteObject[] = (structuredOutput.notes || []).map((note) => ({
    content: note.content,
    added_by: userId,
    source_entity_key: sourceEntityKey,
    date_added: sourceStartedAt,
    expires_at: getExpiresAt(note.lifetime, sourceStartedAt),
  }));

  // Create node using appropriate repository
  const nodeType: EntityType = extractedEntity.entity_type;

  let entityKey: string;
  if (nodeType === 'person') {
    const result = await personRepository.create(
      {
        name: structuredOutput.name,
        description: structuredOutput.description,
        notes,
        user_id: userId,
        last_update_source: sourceEntityKey,
        confidence: extractedEntity.confidence,
        embedding: extractedEntity.embedding,
      },
      sourceEntityKey
    );
    entityKey = result.entity_key;
  } else if (nodeType === 'concept') {
    const result = await conceptRepository.create(
      {
        name: structuredOutput.name,
        description: structuredOutput.description,
        notes,
        user_id: userId,
        embedding: extractedEntity.embedding,
      },
      {
        last_update_source: sourceEntityKey,
        confidence: extractedEntity.confidence,
      },
      sourceEntityKey
    );
    entityKey = result.entity_key;
  } else if (nodeType === 'event') {
    const result = await eventRepository.create(
      {
        name: structuredOutput.name,
        description: structuredOutput.description,
        notes,
        user_id: userId,
        last_update_source: sourceEntityKey,
        confidence: extractedEntity.confidence,
        embedding: extractedEntity.embedding,
      },
      sourceEntityKey
    );
    entityKey = result.entity_key;
  } else {
    const result = await entityRepository.create(
      {
        name: structuredOutput.name,
        description: structuredOutput.description,
        notes,
        user_id: userId,
        last_update_source: sourceEntityKey,
        confidence: extractedEntity.confidence,
        embedding: extractedEntity.embedding,
      },
      sourceEntityKey
    );
    entityKey = result.entity_key;
  }

  console.log(`      ✅ Phase 1 Complete: Created ${nodeType} node with entity_key ${entityKey}`);

  return entityKey;
}

/**
 * Phase 2 only: Create relationships for an existing node
 *
 * Loads neighbors (including source siblings), then uses tool-based agent
 * to create relationships and update neighbors.
 *
 * @param entityKey - Entity key of the existing node
 * @param extractedEntity - Original extracted entity data
 * @param sourceContent - Full conversation transcript
 * @param userId - User ID for context
 * @param sourceEntityKey - Source entity key for provenance
 * @param sourceSiblings - Entities from the same source
 * @param modelName - Model name for agent execution
 * @returns Number of relationships created
 */
export async function runCreateAgentPhase2Only(
  entityKey: string,
  extractedEntity: ExtractedEntity,
  sourceContent: string,
  userId: string,
  sourceEntityKey: string,
  sourceSiblings: SourceSibling[],
  modelName: string = 'gpt-5-nano'
): Promise<number> {
  console.log(`   🔗 CREATE (Phase 2): Creating relationships for "${extractedEntity.name}"`);

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const nodeType = extractedEntity.entity_type;

  // ============================================================================
  // Phase 2: Relationship Creation
  // ============================================================================
  console.log(`      Finding neighbors for relationship creation...`);

  const embeddingNeighbors = await findTopNeighbors(
    userId,
    extractedEntity.entity_type,
    extractedEntity.embedding,
    10
  );

  // Ensure maxNeighbors is large enough to include all source siblings
  // Source siblings should always be available for relationship creation since they came from the same source
  const minNeighbors = 10 + (sourceSiblings?.length || 0);

  const allNeighbors = mergeNeighborsWithSourceSiblings(
    embeddingNeighbors,
    sourceSiblings || [],
    entityKey,
    minNeighbors
  );

  // Filter out self from neighbors list (can't create relationships to self)
  const validNeighbors = allNeighbors.filter(neighbor => neighbor.entity_key !== entityKey);

  if (validNeighbors.length === 0) {
    console.log(`   ⚠️  No valid neighbors found (filtered out self) - skipping relationship creation`);
    return 0;
  }

  // Load created node for context formatting
  const createdNode = await loadNodeByEntityKey(entityKey);
  if (!createdNode) {
    throw new Error(`Failed to fetch created ${nodeType} node with key ${entityKey}`);
  }

  // Build complete neighbor context (loads nodes, builds mapping, formats XML)
  const { neighborNodes, nameToKeyMap, formattedXml: neighborsMarkdown } = await buildNeighborContext(
    validNeighbors,
    createdNode,
    entityKey
  );

  // Format new node description (single line, no notes)
  const newNodeDescription = createdNode.description || `${createdNode.name} (${nodeType})`;

  // Get normalized name for template
  const newNodeNormalizedName = normalizeEntityName(createdNode.name);

  // Log neighbor context being passed to agent
  console.log(`   📋 Passing ${neighborNodes.length} neighbors to Phase 2:`);
  for (const neighbor of neighborNodes.slice(0, 5)) {
    console.log(`      - ${neighbor.name} (${neighbor.entity_type}, similarity: ${neighbor.similarity_score.toFixed(3)})`);
  }
  if (neighborNodes.length > 5) {
    console.log(`      ... and ${neighborNodes.length - 5} more`);
  }

  // ============================================================================
  // Phase 2: Create Relationships and Update Neighbors (Tool-Based Agent)
  // ============================================================================
  console.log(`   Phase 2: Creating relationships and updating neighbors using tools...`);

  // Create tools for relationship creation AND neighbor updates with nameToKeyMap for name resolution
  const createEdge = createEdgeTool(userId, sourceEntityKey, entityKey, nameToKeyMap);
  const updateNode = updateNodeTool(userId, sourceEntityKey);

  const tools = {
    create_edge: createEdge,
    update_node: updateNode,
  };

  const phase2Prompt = `
Your task is to create relevant relationships between the new node and the neighbor nodes based on the source content.

## Source Content
<source_content>
${sourceContent}
</source_content>

## Neighbors (candidates for relationships)
<neighbor_nodes>
${neighborsMarkdown}
</neighbor_nodes>

## New Node
<new_node name="${newNodeNormalizedName}">${newNodeDescription}</new_node>

Review the new node, neighbor list, and source content. Your tasks:
1. Create relevant connections using create_edge where there's a meaningful relationship verified in the source content
   - Use the normalized names shown (e.g., "roy", "paul_peel", "greyrock_mountain")
   - Choose the correct direction parameter based on who is the subject of the relationship
2. Update neighbor nodes using update_node if the new node provides additional context about them

**IMPORTANT COMPLETION RULES**:
- Create each relationship EXACTLY ONCE per neighbor
- The create_edge tool uses MERGE - it will update existing relationships automatically
- When you see "Updated existing" or "Created" in tool results, that relationship is COMPLETE
- DO NOT call create_edge again for the same relationship
- After creating all relevant relationships (typically 2-5), STOP calling tools
- Finish by outputting "Completed relationship creation" without calling any more tools

Focus on creating high-quality, contextually-grounded relationships and updates. Add lots of note content to the relationships to explain the relationship and why it's relevant.
`;

  let relationshipsCreated = 0;
  const createdRelationships = new Set<string>(); // Track created relationships to prevent duplicates

  // Calculate maxSteps based on neighbor count: allow 2x neighbors + 5 buffer
  const dynamicMaxSteps = calculateDynamicMaxSteps(validNeighbors.length);

  await generateText({
    model: openai(modelName, {
      reasoningEffort: 'low', // Use low reasoning for faster execution
    }),
    system: CREATE_RELATIONSHIPS_SYSTEM_PROMPT,
    prompt: phase2Prompt,
    tools,
    maxSteps: dynamicMaxSteps,
    experimental_telemetry: {
      isEnabled: true,
      functionId: `ingestion-phase2-create-relationships-${extractedEntity.entity_type}`,
      metadata: {
        userId,
        sourceEntityKey,
        phase: 'phase2-create-relationships',
        entityType: extractedEntity.entity_type,
        neighborCount: validNeighbors.length,
        maxSteps: dynamicMaxSteps,
      },
    },
    onStepFinish: ({ toolCalls, toolResults, text }) => {
      // Log agent's reasoning and tool calls
      if (toolCalls && toolCalls.length > 0) {
        console.log(`   🤖 Agent decided to call ${toolCalls.length} tool(s):`);
        for (const toolCall of toolCalls) {
          console.log(
            `      - ${toolCall.toolName}:`,
            JSON.stringify(toolCall.args, null, 2).substring(0, 200)
          );

          // Track create_edge calls to detect duplicates
          if (toolCall.toolName === "create_edge") {
            const args = toolCall.args as {
              to_entity_name: string;
              direction: string;
            };
            const relationshipKey = `${args.to_entity_name}-${args.direction}`;

            if (createdRelationships.has(relationshipKey)) {
              console.warn(
                `   ⚠️  WARNING: Duplicate relationship attempt detected: ${relationshipKey}`
              );
              console.warn(
                `   💡 This may indicate the agent is looping - consider stopping early`
              );
            }
            createdRelationships.add(relationshipKey);
          }
        }
      } else if (text) {
        console.log(`   🤖 Agent finished without calling tools`);
        console.log(`   💭 Agent reasoning: ${text.substring(0, 300)}`);
      }

      // Count successful relationship creations from tool execution results
      if (toolResults) {
        for (const toolResult of toolResults) {
          try {
            const parsedResult =
              typeof toolResult.result === "string"
                ? JSON.parse(toolResult.result)
                : toolResult.result;

            // Count successful create_edge tool calls (only count first time, not updates)
            if (
              parsedResult.success === true &&
              toolResult.toolName === "create_edge" &&
              parsedResult.was_created === true
            ) {
              relationshipsCreated++;
            }
          } catch {
            // Ignore non-JSON tool results
          }
        }
      }

      // Safety check: if we've attempted to create more relationships than neighbors × 2, something is wrong
      if (createdRelationships.size > validNeighbors.length * 2) {
        console.error(
          `   🚨 SAFETY STOP: Attempted ${createdRelationships.size} relationship calls for ${validNeighbors.length} neighbors`
        );
        console.error(
          `   💡 This indicates an infinite loop - agent should have stopped by now`
        );
        throw new Error(
          "Agent safety limit exceeded - possible infinite loop detected"
        );
      }
    },
  });

  console.log(`      ✅ Phase 2 Complete: ${relationshipsCreated} relationships created`);

  return relationshipsCreated;
}

/**
 * CREATE Agent orchestration function (Full two-phase approach)
 *
 * Executes two phases:
 * 1. Phase 1: Create structured node using generateObject (structured output)
 * 2. Phase 2: Create relationships and update neighbors using tool-based agent
 *
 * @param extractedEntity - Entity extracted from conversation
 * @param sourceContent - Full conversation transcript (markdown formatted)
 * @param userId - User ID for node creation
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param sourceSiblings - Entities already resolved from this source (for sibling relationships)
 * @param modelName - Model name for agent execution
 * @returns Created node entity_key and relationship count
 */
export async function runCreateAgent(
  extractedEntity: ExtractedEntity,
  sourceContent: string,
  userId: string,
  sourceEntityKey: string,
  sourceSiblings?: SourceSibling[],
  modelName: string = 'gpt-5-nano'
): Promise<{ entityKey: string; relationshipsCreated: number }> {
  console.log(`\n🆕 CREATE Agent: Creating new ${extractedEntity.entity_type} node "${extractedEntity.name}"`);

  // Phase 1: Create node
  const entityKey = await runCreateAgentPhase1Only(
    extractedEntity,
    sourceContent,
    userId,
    sourceEntityKey,
    modelName
  );

  // Phase 2: Create relationships
  const relationshipsCreated = await runCreateAgentPhase2Only(
    entityKey,
    extractedEntity,
    sourceContent,
    userId,
    sourceEntityKey,
    sourceSiblings || [],
    modelName
  );

  return { entityKey, relationshipsCreated };
}

/**
 * Find top neighbors by embedding similarity across ALL entity types
 *
 * Searches Person, Concept, Entity, and Event nodes in parallel to enable
 * cross-type relationships (e.g., Person → Concept, Concept → Entity, Event → Person).
 *
 * @param userId - User ID to scope search
 * @param entityType - Type of entity being created (unused, kept for compatibility)
 * @param embedding - Embedding vector to search with
 * @param topK - Number of top neighbors to return (default: 5)
 * @returns Array of semantic neighbor nodes with similarity scores, sorted by similarity DESC
 */
async function findTopNeighbors(
  userId: string,
  _entityType: EntityType,
  embedding: number[],
  topK: number = 5
): Promise<SemanticNeighbor[]> {
  // Search across ALL four types in parallel
  const [personResults, conceptResults, entityResults, eventResults] = await Promise.all([
    personRepository.findByEmbeddingSimilarity(userId, embedding, 'person', 0.6, topK),
    conceptRepository.findByEmbeddingSimilarity(userId, embedding, 'concept', 0.6, topK),
    entityRepository.findByEmbeddingSimilarity(userId, embedding, 'entity', 0.6, topK),
    eventRepository.findByEmbeddingSimilarity(userId, embedding, 0.6, topK),
  ]);

  // Combine results and tag with type (lowercase EntityType)
  const allResults: SemanticNeighbor[] = [
    ...personResults.map((r) => ({
      entity_key: r.entity_key,
      name: r.name,
      description: r.description || undefined,
      similarity_score: r.similarity_score,
      entity_type: 'person' as const,
    })),
    ...conceptResults.map((r) => ({
      entity_key: r.entity_key,
      name: r.name,
      description: r.description || undefined,
      similarity_score: r.similarity_score,
      entity_type: 'concept' as const,
    })),
    ...entityResults.map((r) => ({
      entity_key: r.entity_key,
      name: r.name,
      description: r.description || undefined,
      similarity_score: r.similarity_score,
      entity_type: 'entity' as const,
    })),
    ...eventResults.map((r) => ({
      entity_key: r.entity_key,
      name: r.name,
      description: r.description || undefined,
      similarity_score: r.similarity_score,
      entity_type: 'event' as const,
    })),
  ];

  // Sort by similarity DESC and take top K
  return allResults
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, topK);
}

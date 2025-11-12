/**
 * Ingestion Agent - LangGraph orchestration for memory extraction pipeline
 *
 * Orchestrates the 3-phase ingestion process:
 * 1. extractAndDisambiguate: Extract entities from transcript + match to existing
 * 2. autoCreateSourceEdges: Create Source [mentions] Node edges
 * 3. relationshipAgent: LLM with tools to create/update nodes and relationships
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (Phase 4)
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/tech.md (lines 228-265)
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { EXTRACTION_SYSTEM_PROMPT, RELATIONSHIP_AGENT_SYSTEM_PROMPT } from './prompts/index.js';
import { ingestionTools } from './tools/registry.js';
import { createExploreTool } from './tools/retrieval/explore.tool.js';
import { createTraverseTool } from './tools/retrieval/traverse.tool.js';
import { sourceRepository } from '../repositories/SourceRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';

// ============================================================================
// State Schema
// ============================================================================

/**
 * Schema for a single extracted entity from the transcript
 */
const ExtractedEntitySchema = z.object({
  mentioned_name: z.string().describe('How the entity was referred to in conversation'),
  entity_type: z.enum(['Person', 'Concept', 'Entity']).describe('Type of entity'),
  entity_subtype: z
    .string()
    .optional()
    .describe('For Entity type: company, place, object, group, institution, product, technology, etc.'),
  context_clue: z.string().describe('Why this should be extracted (user-specific context)'),
  matched_entity_key: z
    .string()
    .nullable()
    .describe('If matched to existing entity, the entity_key'),
  confidence: z.number().min(0).max(1).describe('Confidence in the match or creation'),
  is_new: z.boolean().describe('true if no match found, false if matched to existing'),
});

type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

/**
 * Extraction phase output schema
 */
const ExtractionOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema).describe('List of extracted entities'),
});

/**
 * LangGraph state for ingestion agent
 *
 * Tracks progress through 3-phase pipeline:
 * - conversationId, userId, transcript, summary: Input context
 * - entities: Extracted entities from phase 1
 * - sourceEntityKey: Created Source node entity_key
 * - relationshipMessages: Messages for relationship agent (phase 3)
 */
const IngestionStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  transcript: Annotation<string>,
  summary: Annotation<string>,
  entities: Annotation<ExtractedEntity[]>,
  sourceEntityKey: Annotation<string>,
  relationshipMessages: Annotation<BaseMessage[]>,
});

type IngestionState = typeof IngestionStateAnnotation.State;

// ============================================================================
// Node 1: Extract and Disambiguate
// ============================================================================

/**
 * Phase 1: Extract entities from transcript and match to existing entities
 *
 * Uses LLM structured output to:
 * - Extract all People, Concepts, Entities mentioned
 * - Match each to existing entities via entity_key, canonical_name, or similarity
 * - Output list of resolved entities for downstream processing
 *
 * @param state Current ingestion state
 * @returns Updated state with extracted entities
 */
async function extractAndDisambiguate(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 1: Extract and Disambiguate');

  // Fetch existing entities from Neo4j for matching context
  const [existingPersons, existingConcepts, existingEntities] = await Promise.all([
    personRepository.findByUserId(state.userId),
    conceptRepository.findByUserId(state.userId),
    entityRepository.getAllByUserId(state.userId),
  ]);

  console.log(
    `[Ingestion] Fetched existing entities: ${existingPersons.length} people, ${existingConcepts.length} concepts, ${existingEntities.length} entities`
  );

  // Build rich context for LLM with entity details
  const personLines = existingPersons.map((p) => {
    const details = p.situation ?? p.personality ?? 'No details';
    return `- ${p.canonical_name} (entity_key: ${p.entity_key}): ${details}`;
  });
  const conceptLines = existingConcepts.map((c) => {
    return `- ${c.name} (entity_key: ${c.entity_key}): ${c.description}`;
  });
  const entityLines = existingEntities.map((e) => {
    const description = e.description ?? 'No description';
    return `- ${e.name} (type: ${e.type}, entity_key: ${e.entity_key}): ${description}`;
  });

  const existingEntitiesContext = `
Existing People (${existingPersons.length}):
${personLines.length > 0 ? personLines.join('\n') : '(None)'}

Existing Concepts (${existingConcepts.length}):
${conceptLines.length > 0 ? conceptLines.join('\n') : '(None)'}

Existing Entities (${existingEntities.length}):
${entityLines.length > 0 ? entityLines.join('\n') : '(None)'}
`;

  const userPrompt = `
## Transcript

${state.transcript}

## Existing Entities in Graph

${existingEntitiesContext}

## Instructions

For each Person, Concept, or Entity mentioned in the transcript:
1. Try to match to existing entities by canonical_name (for People) or name similarity (for Concepts/Entities)
2. If matched, return the matched_entity_key
3. If no match or uncertain, mark as new (is_new: true)
4. IMPORTANT: Only extract Concepts/Entities that have user-specific context - casual mentions without personal relevance should be skipped

Extract all mentioned entities and match them to existing entities in the graph.
`;

  // Use GPT-4.1-mini for cost-effective extraction
  const extractionModel = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  }).withStructuredOutput(ExtractionOutputSchema);

  const messages = [new SystemMessage(EXTRACTION_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  const result = await extractionModel.invoke(messages);

  console.log(`[Ingestion] Extracted ${result.entities.length} entities`);

  return {
    entities: result.entities,
  };
}

// ============================================================================
// Node 2: Auto-Create Source Edges
// ============================================================================

/**
 * Phase 2: Create Source node and link to mentioned entities
 *
 * - Creates Source node in Neo4j with transcript content
 * - Creates (Source)-[:mentions]->(Person|Concept|Entity) edges
 * - Updates node updated_at timestamps
 *
 * @param state Current ingestion state with extracted entities
 * @returns Updated state with source entity_key
 */
async function autoCreateSourceEdges(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 2: Auto-Create Source Edges');

  // Create Source node
  const source = await sourceRepository.create({
    user_id: state.userId,
    description: state.summary,
    content: {
      type: 'conversation',
      content: state.transcript,
    },
  });

  console.log(`[Ingestion] Created Source node: ${source.entity_key}`);

  // Link Source to mentioned entities
  // Filter to entities that were matched (have entity_key) or will be created
  const entityLinks = state.entities
    .filter((e) => e.matched_entity_key !== null)
    .map((e) => ({
      type: e.entity_type,
      entity_key: e.matched_entity_key as string,
    }));

  if (entityLinks.length > 0) {
    await sourceRepository.linkToEntities(source.entity_key, entityLinks);
    console.log(`[Ingestion] Created ${entityLinks.length} Source→Entity edges`);
  }

  return {
    sourceEntityKey: source.entity_key,
  };
}

// ============================================================================
// Node 3: Relationship Agent
// ============================================================================

/**
 * Phase 3: Relationship agent with tools for node/relationship creation
 *
 * LLM agent with access to:
 * - 8 node creation/update tools (Person, Concept, Entity)
 * - 2 relationship tools (create, update)
 * - 2 retrieval tools (explore, traverse)
 *
 * Runs until agent signals completion or max iterations (10)
 *
 * @param state Current ingestion state with extracted entities
 * @returns Updated state with relationship messages
 */
async function relationshipAgent(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 3: Relationship Agent');

  // Build context for agent
  const extractedEntitiesSummary = state.entities
    .map(
      (e) =>
        `- ${e.mentioned_name} (${e.entity_type}${e.entity_subtype ? `:${e.entity_subtype}` : ''}): ${e.context_clue} [${e.is_new ? 'NEW' : `MATCHED: ${e.matched_entity_key}`}]`
    )
    .join('\n');

  const userPrompt = `
## Conversation Transcript

${state.transcript}

## Summary

${state.summary}

## Extracted Entities

${extractedEntitiesSummary}

## Task

Create/update nodes and relationships for the extracted entities using the available tools.

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
- source_entity_key: ${state.sourceEntityKey}

Use the conversation_id as last_update_source for all node operations.
`;

  // Initialize relationship agent with tools
  const exploreTool = createExploreTool(state.userId);
  const traverseTool = createTraverseTool(state.userId);
  const allTools = [...ingestionTools, exploreTool, traverseTool];

  const relationshipModel = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  }).bindTools(allTools);

  // Initialize messages
  const messages: BaseMessage[] = [
    new SystemMessage(RELATIONSHIP_AGENT_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ];

  // Run agent loop with max 10 iterations
  const maxIterations = 10;
  let iteration = 0;
  let currentMessages = [...messages];

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[Ingestion] Relationship agent iteration ${iteration}/${maxIterations}`);

    // Invoke model
    const response = await relationshipModel.invoke(currentMessages);
    currentMessages.push(response);

    // Check if agent is done (no tool calls)
    const aiMsg = response as AIMessage;
    if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
      console.log('[Ingestion] Relationship agent complete (no more tool calls)');
      break;
    }

    // Execute tools
    console.log(`[Ingestion] Executing ${aiMsg.tool_calls.length} tool calls`);
    const toolNode = new ToolNode(allTools);
    const toolResults = await toolNode.invoke({ messages: currentMessages });

    // Add tool results to messages
    currentMessages = [...currentMessages, ...(toolResults.messages as BaseMessage[])];
  }

  if (iteration >= maxIterations) {
    console.log('[Ingestion] Relationship agent reached max iterations');
  }

  return {
    relationshipMessages: currentMessages,
  };
}

// ============================================================================
// LangGraph Workflow
// ============================================================================

/**
 * Build the ingestion workflow graph
 *
 * Flow: START → extractAndDisambiguate → autoCreateSourceEdges → relationshipAgent → END
 */
const workflow = new StateGraph(IngestionStateAnnotation)
  .addNode('extractAndDisambiguate', extractAndDisambiguate)
  .addNode('autoCreateSourceEdges', autoCreateSourceEdges)
  .addNode('relationshipAgent', relationshipAgent)
  .addEdge(START, 'extractAndDisambiguate')
  .addEdge('extractAndDisambiguate', 'autoCreateSourceEdges')
  .addEdge('autoCreateSourceEdges', 'relationshipAgent')
  .addEdge('relationshipAgent', END);

/**
 * Compiled ingestion graph
 */
const ingestionGraph = workflow.compile();

// ============================================================================
// Public API
// ============================================================================

/**
 * Run the complete ingestion pipeline for a conversation
 *
 * Executes 3-phase workflow:
 * 1. Extract and disambiguate entities from transcript
 * 2. Create Source node and mention edges
 * 3. Run relationship agent to create/update nodes and relationships
 *
 * @param conversationId - Conversation ID for provenance tracking
 * @param userId - User ID for entity resolution and creation
 * @param transcript - Full conversation transcript
 * @param summary - ~100 word summary of conversation
 * @returns Promise that resolves when ingestion completes
 */
export async function runIngestionAgent(
  conversationId: string,
  userId: string,
  transcript: string,
  summary: string
): Promise<void> {
  console.log(`[Ingestion] Starting ingestion for conversation ${conversationId}`);

  const initialState: Partial<IngestionState> = {
    conversationId,
    userId,
    transcript,
    summary,
    entities: [],
    sourceEntityKey: '',
    relationshipMessages: [],
  };

  try {
    await ingestionGraph.invoke(initialState);
    console.log(`[Ingestion] Completed ingestion for conversation ${conversationId}`);
  } catch (error) {
    console.error(`[Ingestion] Error during ingestion for conversation ${conversationId}:`, error);
    throw error;
  }
}

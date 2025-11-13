/**
 * Ingestion Agent - LangGraph orchestration for memory extraction pipeline
 *
 * Orchestrates the 4-phase ingestion process:
 * 0. cleanupContent (unified): Convert all source types to structured bullet notes
 * 1. extractAndDisambiguate: Extract entities from notes + match to existing
 * 2. autoCreateSourceEdges: Create Source [mentions] Node edges
 * 3. relationshipAgent: LLM with tools to create/update nodes and relationships
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (Phase 4)
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/tech.md (lines 228-265)
 */

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { sourceRepository } from '../repositories/SourceRepository.js';
import { EXTRACTION_SYSTEM_PROMPT, RELATIONSHIP_AGENT_SYSTEM_PROMPT } from './prompts/index.js';
import { ingestionTools } from './tools/registry.js';
import { createExploreTool } from './tools/retrieval/explore.tool.js';
import { createTraverseTool } from './tools/retrieval/traverse.tool.js';
import { ConversationTurn, SttTurn } from '../types/dto.js';

// ============================================================================
// State Schema
// ============================================================================

/**
 * Schema for a single extracted entity from the transcript
 * Simple extraction - no matching logic, just entity names and types
 */
const ExtractedEntitySchema = z.object({
  name: z.string().describe('How the entity was referred to in conversation'),
  entity_type: z.enum(['Person', 'Concept', 'Entity']).describe('Type of entity'),
  confidence: z.number().int().min(1).max(10).describe('Confidence score 1-10: How many inclusion gates passed? 4 gates=9-10, 3 gates=7-8, 2 gates=5-6, 1 gate=3-4'),
  subpoints: z.array(z.string()).default([]).describe('Elaboration points - For Concepts: sub-techniques/strategies; For People: interactions/attributes; For Entities: usage/features. 0-1 subpoints = lacks depth.'),
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
 * Tracks progress through 4-phase pipeline:
 * - sourceId, userId: Identifiers for provenance tracking
 * - contentRaw: Raw content (varies by source_type)
 * - contentProcessed: Cleaned bullet points from Phase 0
 * - summary: Human-readable summary
 * - sourceType: Type of source (conversation, information_dump, stt, document)
 * - entities: Extracted entities from phase 1
 * - sourceEntityKey: Created Source node entity_key
 * - relationshipMessages: Messages for relationship agent (phase 3)
 */
const IngestionStateAnnotation = Annotation.Root({
  sourceId: Annotation<string>,
  userId: Annotation<string>,
  contentRaw: Annotation<ConversationTurn[] | SttTurn[] | string>,
  contentProcessed: Annotation<string[]>,
  summary: Annotation<string>,
  sourceType: Annotation<'conversation' | 'information_dump' | 'stt' | 'document'>,
  entities: Annotation<ExtractedEntity[]>,
  sourceEntityKey: Annotation<string>,
  relationshipMessages: Annotation<BaseMessage[]>,
});

type IngestionState = typeof IngestionStateAnnotation.State;

// ============================================================================
// Node 0: Cleanup Content (Unified - runs for ALL source types)
// ============================================================================

/**
 * Phase 0: Clean up content and convert to structured bullet points
 *
 * Runs for ALL source types (conversation, stt, information_dump, document)
 *
 * Steps:
 * 1. Extract relevant content by source type (filter user messages for conversations, etc.)
 * 2. Run cleanup LLM to convert to bullet points
 * 3. Store bullets in contentProcessed for downstream phases
 *
 * Uses GPT-4o-mini for cost-effective cleanup
 *
 * @param state Current ingestion state with contentRaw
 * @returns Updated state with contentProcessed bullets
 */
async function cleanupContent(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log(`[Ingestion] Phase 0: Cleaning up content for source_type="${state.sourceType}"`);

  let rawText: string;

  // Step 1: Extract relevant content by source type
  switch (state.sourceType) {
    case 'conversation':
      // Filter to only user messages (assistant messages not important)
      const conversationArray = state.contentRaw as ConversationTurn[];
      const userMessages = conversationArray
        .filter(turn => turn.speaker === 'user')
        .map(turn => turn.message);
      rawText = userMessages.join('\n\n');
      break;

    case 'stt':
      // Keep all speakers
      const sttArray = state.contentRaw as SttTurn[];
      rawText = sttArray
        .map(turn => `${turn.speaker}: ${turn.message}`)
        .join('\n');
      break;

    case 'information_dump':
    case 'document':
      // Already a text blob
      rawText = state.contentRaw as string;
      break;

    default:
      rawText = JSON.stringify(state.contentRaw);
  }

  // Step 2: Run cleanup LLM
  const llm = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  });

  const cleanupPrompt = `You are a data cleaning assistant. Extract key information from the user's ${state.sourceType} and convert it to a clean list of bullet points.

Rules:
- Each bullet should be a complete, self-contained piece of information
- Remove filler words, false starts, repetition
- Preserve all factual content and context
- Format: "- [bullet point]"
- Return ONLY the bullet list, no other text`;

  try {
    const response = await llm.invoke([
      new SystemMessage(cleanupPrompt),
      new HumanMessage(rawText)
    ]);

    // Step 3: Parse bullets
    const contentText = typeof response.content === 'string' ? response.content : String(response.content);
    const bullets = contentText
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.trim());

    console.log(`[Ingestion] Phase 0: Generated ${bullets.length} bullet points`);

    return { contentProcessed: bullets };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Ingestion] Phase 0: Content cleanup failed (${errorMessage}), using raw text`);
    // Fallback: split raw text into sentences as bullets
    const fallbackBullets = rawText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => `- ${s}`);
    return { contentProcessed: fallbackBullets };
  }
}

// ============================================================================
// Node 1: Extract and Disambiguate
// ============================================================================

/**
 * Phase 1: Extract entities from processed content (no matching)
 *
 * Uses LLM structured output to:
 * - Extract all People, Concepts, Entities mentioned in the content
 * - Output simple list of entity names and types
 * - No matching logic - Phase 3 agent will use explore tool to match
 *
 * @param state Current ingestion state with contentProcessed
 * @returns Updated state with extracted entities
 */
async function extractAndDisambiguate(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 1: Extract Entities');

  const contentText = state.contentProcessed.join('\n');

  const userPrompt = `
## Content

${contentText}

## Instructions

Extract all People, Concepts, and Entities mentioned in the content.

IMPORTANT: Only extract Concepts/Entities that have user-specific context - casual mentions without personal relevance should be skipped.

Examples:
- "Chicago" mentioned casually → NOT an entity
- "Chicago" with user's plans/feelings → YES, extract as Entity
- "My startup" or "work project" → YES, extract as Concept
- "Python" mentioned in passing → NOT an entity
- "Learning Python for my new job" → YES, extract as Concept or Entity

For each entity, provide:
- name: How it was referred to in the conversation
- entity_type: Person, Concept, or Entity
`;

  // Use GPT-4.1-mini for cost-effective extraction
  const extractionModel = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
  }).withStructuredOutput(ExtractionOutputSchema);

  const messages = [new SystemMessage(EXTRACTION_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  const result = await extractionModel.invoke(messages);

  console.log(`[Ingestion] Extracted ${result.entities.length} entities`);
  console.log('[Ingestion] Entities:');
  result.entities.forEach((entity, idx) => {
    console.log(`  ${idx + 1}. ${entity.name} (${entity.entity_type})`);
  });

  // Ensure all entities have subpoints array (Zod default should handle this, but be explicit)
  const entitiesWithDefaults = result.entities.map(e => ({
    ...e,
    subpoints: e.subpoints ?? [],
  }));

  return {
    entities: entitiesWithDefaults,
  };
}

// ============================================================================
// Node 2: Auto-Create Source Edges
// ============================================================================

/**
 * Phase 2: Create Source node only (edges created after Phase 3)
 *
 * - Creates Source node in Neo4j with processed content
 * - Source→mentions edges will be created after Phase 3 based on what entities were touched
 *
 * @param state Current ingestion state with extracted entities
 * @returns Updated state with source entity_key
 */
async function autoCreateSourceEdges(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 2: Create Source Node');

  // Create Source node
  const source = await sourceRepository.create({
    user_id: state.userId,
    description: state.summary,
    content: {
      type: state.sourceType,
      content: state.contentProcessed.join('\n'),
    },
  });

  console.log(`[Ingestion] Created Source node: ${source.entity_key}`);

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
 * - Node creation/update tools (Person, Concept, Entity)
 * - Relationship tools (create, update)
 * - Retrieval tools (explore, traverse) for matching entities
 *
 * Agent uses explore tool to match extracted entities to existing nodes,
 * then creates/updates nodes and relationships as appropriate.
 *
 * Runs until agent signals completion or max iterations (10)
 *
 * @param state Current ingestion state with extracted entities
 * @returns Updated state with relationship messages
 */
async function relationshipAgent(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 3: Relationship Agent');

  // Build simple list of extracted entities
  const extractedEntitiesSummary = state.entities
    .map((e) => `- ${e.name} (${e.entity_type})`)
    .join('\n');

  const contentText = state.contentProcessed.join('\n');

  const userPrompt = `
## Content

${contentText}

## Summary

${state.summary}

## Extracted Entities (from Phase 1)

${extractedEntitiesSummary}

## Task

For each extracted entity:
1. Use the explore tool to search for existing entities with similar names
2. If a match exists, update it with new information from the content
3. If no match exists, create a new node
4. Create relationships between entities as described in the content

## CRITICAL: Separate Node vs Relationship Information

**Node updates should contain INTRINSIC information** (what the entity IS):
- Person: Personality, general situation, appearance, skills, history
- Concept: Core description, what it is, objective details
- Entity: What it is, objective properties

**Relationship notes should contain RELATIONAL information** (HOW entities connect):
- Feelings, attitudes, context of connection
- User-specific relevance or significance
- How entities influence each other

**DO NOT duplicate information!**
- Example: "John mentioned his startup" →
  - ✅ Update John node: situation = "Working on a startup"
  - ✅ Create John→Concept(startup) relationship: notes = "John is the founder, mentioned feeling stressed about fundraising"
  - ❌ Update John node: notes = "Working on startup, stressed about fundraising" AND create relationship with same info

Think carefully: Is this information intrinsic to the entity, or does it describe a relationship?

## Technical Details

- Use source_id as last_update_source for all node operations
- The explore tool accepts text_matches for exact name searches and queries for semantic search
- For People, search by name using text_matches
- For Concepts/Entities, you can use semantic queries or text_matches

Context:
- source_id: ${state.sourceId}
- user_id: ${state.userId}
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
    aiMsg.tool_calls.forEach((toolCall, idx) => {
      const args = JSON.stringify(toolCall.args, null, 2)
        .split('\n')
        .map((line, i) => (i === 0 ? line : `      ${line}`))
        .join('\n');
      console.log(`  ${idx + 1}. ${toolCall.name}`);
      console.log(`      ${args}`);
    });

    const toolNode = new ToolNode(allTools);
    const toolResults = await toolNode.invoke({ messages: currentMessages });

    // Log tool results
    const resultMessages = toolResults.messages as BaseMessage[];
    resultMessages.forEach((msg, idx) => {
      if (msg._getType() === 'tool') {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        console.log(`  ${idx + 1}. Result: ${preview}`);
      }
    });

    // Add tool results to messages
    currentMessages = [...currentMessages, ...resultMessages];
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
 * Flow: START → cleanupContent → extractAndDisambiguate → autoCreateSourceEdges → relationshipAgent → END
 */
const workflow = new StateGraph(IngestionStateAnnotation)
  .addNode('cleanupContent', cleanupContent)
  .addNode('extractAndDisambiguate', extractAndDisambiguate)
  .addNode('autoCreateSourceEdges', autoCreateSourceEdges)
  .addNode('relationshipAgent', relationshipAgent)
  .addEdge(START, 'cleanupContent')
  .addEdge('cleanupContent', 'extractAndDisambiguate')
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
 * Run the complete ingestion pipeline for any source type
 *
 * Executes 4-phase workflow:
 * 0. Clean up content and convert to bullet points (runs for ALL source types)
 * 1. Extract entities from processed content
 * 2. Create Source node
 * 3. Run relationship agent to match/create nodes and relationships
 *
 * @param sourceId - Source ID for provenance tracking
 * @param userId - User ID for entity resolution and creation
 * @param contentRaw - Raw content (varies by source_type: ConversationTurn[] | SttTurn[] | string)
 * @param summary - ~100 word summary of content (null allowed)
 * @param sourceType - Type of source (conversation, information_dump, stt, document)
 * @returns Promise with sourceEntityKey and contentProcessed bullets
 */
export async function runIngestionAgent(
  sourceId: string,
  userId: string,
  contentRaw: ConversationTurn[] | SttTurn[] | string,
  summary: string | null,
  sourceType: 'conversation' | 'information_dump' | 'stt' | 'document'
): Promise<{ sourceEntityKey: string; contentProcessed: string[] }> {
  console.log(`[Ingestion] Starting ingestion for ${sourceType} ${sourceId}`);

  if (!summary) {
    throw new Error(`Summary is required for source ${sourceId}`);
  }

  const initialState: Partial<IngestionState> = {
    sourceId,
    userId,
    contentRaw,
    contentProcessed: [],
    summary,
    sourceType,
    entities: [],
    sourceEntityKey: '',
    relationshipMessages: [],
  };

  try {
    const finalState = await ingestionGraph.invoke(initialState);
    console.log(`[Ingestion] Completed ingestion for source ${sourceId}`);

    return {
      sourceEntityKey: finalState.sourceEntityKey,
      contentProcessed: finalState.contentProcessed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Ingestion] Failed for source ${sourceId}:`, errorMessage);
    throw error;
  }
}

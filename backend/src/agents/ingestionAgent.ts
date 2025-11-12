/**
 * Ingestion Agent - LangGraph orchestration for memory extraction pipeline
 *
 * Orchestrates the 4-phase ingestion process:
 * 0. convertToNotes (conditional): Convert voice memos to structured bullet notes
 * 1. extractAndDisambiguate: Extract entities from transcript/notes + match to existing
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
 * - sourceType: Type of source (conversation, voice-memo, meeting, etc.)
 * - entities: Extracted entities from phase 1
 * - sourceEntityKey: Created Source node entity_key
 * - relationshipMessages: Messages for relationship agent (phase 3)
 */
const IngestionStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>,
  userId: Annotation<string>,
  transcript: Annotation<string>,
  summary: Annotation<string>,
  sourceType: Annotation<string>,
  entities: Annotation<ExtractedEntity[]>,
  sourceEntityKey: Annotation<string>,
  relationshipMessages: Annotation<BaseMessage[]>,
});

type IngestionState = typeof IngestionStateAnnotation.State;

// ============================================================================
// Node 0: Convert to Structured Notes (Conditional - only for STT sources)
// ============================================================================

/**
 * Phase 0: Convert transcript to structured notes (optional, only for voice/STT sources)
 *
 * Uses GPT-5-nano (reasoning model) to:
 * - Extract all meaningful information from transcript
 * - Convert to bulleted note format
 * - Fix STT errors and make inferences
 * - Normalize names and technical terms
 * - Remove filler words while preserving all content
 *
 * Only executes when sourceType indicates STT source (voice-memo, meeting, phone-call, etc.)
 *
 * @param state Current ingestion state
 * @returns Updated state with structured notes as transcript (or unchanged if not STT source)
 */
async function convertToNotes(state: IngestionState): Promise<Partial<IngestionState>> {
  // Check if this is an STT source that needs cleanup
  const sttSourceTypes = ['voice-memo', 'meeting', 'phone-call', 'voice-note'];
  const needsCleanup = sttSourceTypes.includes(state.sourceType);

  if (!needsCleanup) {
    console.log(`[Ingestion] Phase 0: Skipping notes extraction for source_type="${state.sourceType}"`);
    return {}; // No changes to state
  }

  console.log('[Ingestion] Phase 0: Converting transcript to structured notes (STT source detected)');

  const systemPrompt = `You are an expert at converting messy voice memo transcripts into clear, structured notes.

## Your Task

Transform this voice memo transcript into a comprehensive bulleted list that captures ALL useful information while organizing thoughts clearly.

## Guidelines

**Extract Everything Meaningful**:
- People mentioned (with context about them)
- Thoughts, feelings, observations
- Plans, ideas, goals
- Problems, concerns, questions
- Insights, realizations, conclusions
- Specific examples or anecdotes

**Make Inferences**:
- When speech is unclear or garbled, infer the most likely meaning from context
- Fix obvious STT errors inline without calling attention to them
- If someone is mentioned multiple times with different name spellings, pick one canonical form
- When fragments don't make grammatical sense, reconstruct the intended meaning

**Organization**:
- Use a flat bulleted list (just dashes, no nested bullets)
- Each bullet should be ONE complete thought or fact
- Group related thoughts together, but keep bullets separate
- Start with context (who/what/when if mentioned)
- Then observations/feelings/thoughts
- Then insights/realizations
- Then plans/ideas for the future

**Preserve**:
- All names (people, companies, products, places)
- Specific details (numbers, dates, events)
- Emotional context (frustrations, excitements, concerns)
- Actual words/phrases that matter ("I want to...", "The problem is...")

**Remove**:
- Filler words (um, uh, like, you know)
- False starts and repetitions
- "I mean, I think, you know" unless it's part of the actual meaning
- Rambling that doesn't add information

## Output Format

Return ONLY the bulleted list. Each bullet starts with "- " (dash space).

Example transformation:
Input: "So, um, I was talking to, like, Sarah, and she was saying that, you know, the project is kind of behind schedule? Which is frustrating because, like, we really need to ship this thing."

Output:
- Talked to Sarah about the project
- Project is behind schedule
- Feeling frustrated about the delay
- Need to ship soon

**CRITICAL**: Lose ZERO useful information. If something was said, it should appear in the notes somewhere.`;

  const model = new ChatOpenAI({
    modelName: 'gpt-5-nano',
    reasoning: {
      effort: 'medium', // Medium reasoning for better error detection
    },
  });

  const messages = [new SystemMessage(systemPrompt), new HumanMessage(state.transcript)];

  try {
    const response = await model.invoke(messages);
    const structuredNotes =
      typeof response.content === 'string' ? response.content : String(response.content);

    const bulletCount = (structuredNotes.match(/^- /gm) || []).length;
    const compressionPct = ((state.transcript.length - structuredNotes.length) / state.transcript.length * 100).toFixed(1);

    console.log(
      `[Ingestion] Phase 0: Extracted ${bulletCount} notes (${state.transcript.length} → ${structuredNotes.length} chars, ${compressionPct}% compression)`
    );

    return {
      transcript: structuredNotes,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Ingestion] Phase 0: Notes extraction failed (${errorMessage}), using original transcript`);
    // Don't throw - notes extraction is nice-to-have, not critical
    return {}; // Return empty object to keep original transcript
  }
}

// ============================================================================
// Node 1: Extract and Disambiguate
// ============================================================================

/**
 * Phase 1: Extract entities from transcript (no matching)
 *
 * Uses LLM structured output to:
 * - Extract all People, Concepts, Entities mentioned in the transcript
 * - Output simple list of entity names and types
 * - No matching logic - Phase 3 agent will use explore tool to match
 *
 * @param state Current ingestion state
 * @returns Updated state with extracted entities
 */
async function extractAndDisambiguate(state: IngestionState): Promise<Partial<IngestionState>> {
  console.log('[Ingestion] Phase 1: Extract Entities');

  const userPrompt = `
## Transcript

${state.transcript}

## Instructions

Extract all People, Concepts, and Entities mentioned in the transcript.

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

  return {
    entities: result.entities,
  };
}

// ============================================================================
// Node 2: Auto-Create Source Edges
// ============================================================================

/**
 * Phase 2: Create Source node only (edges created after Phase 3)
 *
 * - Creates Source node in Neo4j with transcript content
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
      content: state.transcript,
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

  const userPrompt = `
## Conversation Transcript

${state.transcript}

## Summary

${state.summary}

## Extracted Entities (from Phase 1)

${extractedEntitiesSummary}

## Task

For each extracted entity:
1. Use the explore tool to search for existing entities with similar names
2. If a match exists, update it with new information from the transcript
3. If no match exists, create a new node
4. Create relationships between entities as described in the conversation

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

- Use conversation_id as last_update_source for all node operations
- The explore tool accepts text_matches for exact name searches and queries for semantic search
- For People, search by name using text_matches
- For Concepts/Entities, you can use semantic queries or text_matches

Context:
- conversation_id: ${state.conversationId}
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
 * Flow: START → convertToNotes (conditional) → extractAndDisambiguate → autoCreateSourceEdges → relationshipAgent → END
 */
const workflow = new StateGraph(IngestionStateAnnotation)
  .addNode('convertToNotes', convertToNotes)
  .addNode('extractAndDisambiguate', extractAndDisambiguate)
  .addNode('autoCreateSourceEdges', autoCreateSourceEdges)
  .addNode('relationshipAgent', relationshipAgent)
  .addEdge(START, 'convertToNotes')
  .addEdge('convertToNotes', 'extractAndDisambiguate')
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
 * Executes 4-phase workflow:
 * 0. Convert to structured notes (conditional - only for STT sources like voice-memo, meeting)
 * 1. Extract entities from transcript/notes
 * 2. Create Source node
 * 3. Run relationship agent to match/create nodes and relationships
 *
 * @param conversationId - Conversation ID for provenance tracking
 * @param userId - User ID for entity resolution and creation
 * @param transcript - Full conversation transcript (will be converted to notes if STT source)
 * @param summary - ~100 word summary of conversation
 * @param sourceType - Type of source (conversation, voice-memo, meeting, journal, etc.)
 * @returns Promise with sourceEntityKey for creating Source→mentions edges
 */
export async function runIngestionAgent(
  conversationId: string,
  userId: string,
  transcript: string,
  summary: string,
  sourceType: string = 'conversation'
): Promise<{ sourceEntityKey: string; processedTranscript: string }> {
  console.log(`[Ingestion] Starting ingestion for ${sourceType} ${conversationId}`);

  const initialState: Partial<IngestionState> = {
    conversationId,
    userId,
    transcript,
    summary,
    sourceType,
    entities: [],
    sourceEntityKey: '',
    relationshipMessages: [],
  };

  try {
    const finalState = await ingestionGraph.invoke(initialState);
    console.log(`[Ingestion] Completed ingestion for conversation ${conversationId}`);

    return {
      sourceEntityKey: finalState.sourceEntityKey,
      processedTranscript: finalState.transcript, // May be notes if STT source
    };
  } catch (error) {
    console.error(`[Ingestion] Error during ingestion for conversation ${conversationId}:`, error);
    throw error;
  }
}

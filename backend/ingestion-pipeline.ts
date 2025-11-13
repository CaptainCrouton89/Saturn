/**
 * Ingestion Pipeline Test - New Architecture
 *
 * 5-phase pipeline with lightweight update collection + parallel processing:
 * - Phase 0: Convert to structured notes (conditional, STT sources only)
 * - Phase 1: Extract and disambiguate entities
 * - Phase 2: Create Source node (mocked)
 * - Phase 3: Collect rich textual updates for each entity (lightweight)
 * - Phase 4: Process updates into structured nodes + relationships (3 parallel agents)
 *
 * Usage: tsx ingestion-pipeline.ts
 */

import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  CONCEPT_PROCESSING_SYSTEM_PROMPT,
  ENTITY_PROCESSING_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  NOTES_EXTRACTION_SYSTEM_PROMPT,
  PERSON_PROCESSING_SYSTEM_PROMPT,
  UPDATE_COLLECTION_SYSTEM_PROMPT,
} from './src/agents/prompts/ingestion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  conversationId: 'test-conversation-123',
  userId: 'test-user-456',
  sourceType: 'voice-memo', // 'voice-memo' | 'conversation' | 'meeting' | 'phone-call' | 'voice-note'
  sampleDataPath: path.join(__dirname, '../sample-memo.txt'),
  outputDir: __dirname,
  startPhase: 0, // Start from phase N (0-4)
  maxPhase: 4,   // Stop after phase N (0-4)
};

// ============================================================================
// Schemas
// ============================================================================

const ExtractedEntitySchema = z.object({
  name: z.string(),
  entity_type: z.enum(['Person', 'Concept', 'Entity']),
  confidence: z.number().int().min(1).max(10),
  subpoints: z.array(z.string()).default([]),
});

type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

const ExtractionOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema),
});

// ============================================================================
// State Interfaces
// ============================================================================

interface NodeUpdate {
  content: string;
  timestamp: string;
  source_id: string;
  processed: boolean;
}

interface NodeWithUpdates {
  identifier: string;
  entity_key?: string;
  entity_type: 'Person' | 'Concept' | 'Entity';
  updates: NodeUpdate[];
}

interface PipelineState {
  conversationId: string;
  userId: string;
  transcript: string;
  summary: string;
  sourceType: string;
  entities: ExtractedEntity[];
  sourceEntityKey: string;
  nodesWithUpdates: NodeWithUpdates[];
}

// ============================================================================
// Mock Neo4j (for Phase 4)
// ============================================================================

interface MockNode {
  entity_key: string;
  type: 'Person' | 'Concept' | 'Entity';
  properties: Record<string, unknown>;
}

interface MockRelationship {
  from_entity_key: string;
  to_entity_key: string;
  type: string;
  properties: Record<string, unknown>;
}

class MockNeo4j {
  nodes: MockNode[] = [];
  relationships: MockRelationship[] = [];

  createPerson(args: Record<string, unknown>) {
    const entityKey = `person_${args.canonical_name}_${CONFIG.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Person',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updatePerson(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createConcept(args: Record<string, unknown>) {
    const entityKey = `concept_${args.name}_${CONFIG.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Concept',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updateConcept(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createEntity(args: Record<string, unknown>) {
    const entityKey = `entity_${args.name}_${CONFIG.userId}`;
    this.nodes.push({
      entity_key: entityKey,
      type: 'Entity',
      properties: { ...args, entity_key: entityKey },
    });
    return { success: true, entity_key: entityKey };
  }

  updateEntity(args: Record<string, unknown>) {
    const node = this.nodes.find((n) => n.entity_key === args.entity_key);
    if (node) {
      node.properties = { ...node.properties, ...args };
    }
    return { success: true };
  }

  createRelationship(args: Record<string, unknown>) {
    this.relationships.push({
      from_entity_key: args.from_entity_key as string,
      to_entity_key: args.to_entity_key as string,
      type: args.relationship_type as string,
      properties: args.properties as Record<string, unknown>,
    });
    return { success: true };
  }

  updateRelationship(args: Record<string, unknown>) {
    const rel = this.relationships.find(
      (r) =>
        r.from_entity_key === args.from_entity_key &&
        r.to_entity_key === args.to_entity_key &&
        r.type === args.relationship_type
    );
    if (rel) {
      rel.properties = { ...rel.properties, ...args.properties };
    }
    return { success: true };
  }
}

const mockNeo4j = new MockNeo4j();

// ============================================================================
// Mock Tools for Phase 3 (Update Collection)
// ============================================================================

const phase3Tools = [
  {
    type: 'function',
    function: {
      name: 'createNodeWithUpdate',
      description: 'Create new node with textual update',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Human-readable identifier (e.g., "Sarah", "Active listening")' },
          entity_type: { type: 'string', enum: ['Person', 'Concept', 'Entity'] },
          update: { type: 'string', description: 'Comprehensive textual update about this entity' },
        },
        required: ['identifier', 'entity_type', 'update'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateNodeWithUpdate',
      description: 'Add update to existing node',
      parameters: {
        type: 'object',
        properties: {
          entity_key: { type: 'string', description: 'Entity key of existing node' },
          update: { type: 'string', description: 'Additional textual update' },
        },
        required: ['entity_key', 'update'],
      },
    },
  },
];

// ============================================================================
// Mock Tools for Phase 4 (Node Processing)
// ============================================================================

const phase4Tools = [
  // Person tools
  {
    type: 'function',
    function: {
      name: 'createPerson',
      description: 'Create Person node',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          canonical_name: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
          situation: { type: 'string' },
          personality: { type: 'string' },
          appearance: { type: 'string' },
          history: { type: 'string' },
          expertise: { type: 'string' },
          interests: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['user_id', 'canonical_name', 'last_update_source', 'confidence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updatePerson',
      description: 'Update Person node',
      parameters: {
        type: 'object',
        properties: {
          entity_key: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
          situation: { type: 'string' },
          personality: { type: 'string' },
          appearance: { type: 'string' },
          history: { type: 'string' },
          expertise: { type: 'string' },
          interests: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['entity_key'],
      },
    },
  },
  // Concept tools
  {
    type: 'function',
    function: {
      name: 'createConcept',
      description: 'Create Concept node',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['user_id', 'name', 'description', 'last_update_source', 'confidence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateConcept',
      description: 'Update Concept node',
      parameters: {
        type: 'object',
        properties: {
          entity_key: { type: 'string' },
          description: { type: 'string' },
          notes: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['entity_key'],
      },
    },
  },
  // Entity tools
  {
    type: 'function',
    function: {
      name: 'createEntity',
      description: 'Create Entity node',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['user_id', 'name', 'type', 'description', 'last_update_source', 'confidence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateEntity',
      description: 'Update Entity node',
      parameters: {
        type: 'object',
        properties: {
          entity_key: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          notes: { type: 'string' },
          last_update_source: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['entity_key'],
      },
    },
  },
  // Relationship tools
  {
    type: 'function',
    function: {
      name: 'createRelationship',
      description: 'Create relationship between nodes',
      parameters: {
        type: 'object',
        properties: {
          from_entity_key: { type: 'string' },
          to_entity_key: { type: 'string' },
          relationship_type: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['from_entity_key', 'to_entity_key', 'relationship_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateRelationship',
      description: 'Update relationship properties',
      parameters: {
        type: 'object',
        properties: {
          from_entity_key: { type: 'string' },
          to_entity_key: { type: 'string' },
          relationship_type: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['from_entity_key', 'to_entity_key', 'relationship_type'],
      },
    },
  },
];

// ============================================================================
// Phase 0: Convert to Structured Notes
// ============================================================================

async function phase0_convertToNotes(state: PipelineState): Promise<string> {
  if (CONFIG.startPhase > 0 || CONFIG.maxPhase < 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('PHASE 0: Convert to Structured Notes');
    console.log('='.repeat(80));
    console.log(`⏭️  Skipped (startPhase=${CONFIG.startPhase})\n`);

    const notesPath = path.join(CONFIG.outputDir, 'pipeline-phase0-notes.txt');
    if (fs.existsSync(notesPath)) {
      const existingNotes = fs.readFileSync(notesPath, 'utf-8');
      console.log(`📂 Loaded existing notes from previous run\n`);
      return existingNotes;
    }
    return state.transcript;
  }

  const sttSourceTypes = ['voice-memo', 'meeting', 'phone-call', 'voice-note'];
  if (!sttSourceTypes.includes(state.sourceType)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log('PHASE 0: Convert to Structured Notes');
    console.log('='.repeat(80));
    console.log(`⏭️  Skipping (source_type="${state.sourceType}" is not STT source)\n`);
    return state.transcript;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 0: Convert to Structured Notes');
  console.log('='.repeat(80));
  console.log(`📝 Converting transcript to structured notes\n`);

  const model = new ChatOpenAI({
    modelName: 'gpt-5-nano',
    reasoning: { effort: 'medium' },
  });

  const messages = [
    new SystemMessage(NOTES_EXTRACTION_SYSTEM_PROMPT),
    new HumanMessage(`## Transcript\n\n${state.transcript}\n\n## Instructions\n\nConvert the transcript to structured notes, in chronological order.`),
  ];

  const startTime = Date.now();
  const response = await model.invoke(messages);
  const duration = Date.now() - startTime;

  const structuredNotes = typeof response.content === 'string' ? response.content : String(response.content);

  console.log(`✅ Conversion completed in ${duration}ms`);
  console.log(`📉 Compression: ${state.transcript.length} → ${structuredNotes.length} chars`);

  const outputPath = path.join(CONFIG.outputDir, 'pipeline-phase0-notes.txt');
  fs.writeFileSync(outputPath, structuredNotes);
  console.log(`💾 Saved to: ${outputPath}\n`);

  return structuredNotes;
}

// ============================================================================
// Phase 1: Extract Entities
// ============================================================================

async function phase1_extractEntities(transcript: string): Promise<ExtractedEntity[]> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 1: Extract and Disambiguate Entities');
  console.log('='.repeat(80));
  console.log('🔍 Extracting People, Concepts, and Entities\n');

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' }).withStructuredOutput(ExtractionOutputSchema);

  const messages = [
    new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
    new HumanMessage(`## Transcript\n\n${transcript}\n\n## Instructions\n\nExtract all People, Concepts, and Entities mentioned in the transcript.`),
  ];

  const startTime = Date.now();
  const result = await model.invoke(messages);
  const duration = Date.now() - startTime;

  result.entities.sort((a, b) => b.confidence - a.confidence);

  console.log(`✅ Extraction completed in ${duration}ms`);
  console.log(`📋 Extracted ${result.entities.length} entities\n`);

  result.entities.forEach((e, idx) => {
    console.log(`  ${idx + 1}. ${e.name} (${e.entity_type}) [confidence: ${e.confidence}/10]`);
  });

  const CONFIDENCE_THRESHOLD = 7;
  const SUBPOINTS_THRESHOLD = 2;
  const filtered = result.entities.filter(
    (e) => e.confidence >= CONFIDENCE_THRESHOLD && (e.subpoints?.length ?? 0) > SUBPOINTS_THRESHOLD
  );

  console.log(`\n✅ Final extraction: ${filtered.entities} entities (confidence >=${CONFIDENCE_THRESHOLD}, subpoints >${SUBPOINTS_THRESHOLD})\n`);

  const outputPath = path.join(CONFIG.outputDir, 'pipeline-phase1-entities.json');
  fs.writeFileSync(outputPath, JSON.stringify({ all: result.entities, filtered, filters: { CONFIDENCE_THRESHOLD, SUBPOINTS_THRESHOLD } }, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);

  return filtered;
}

// ============================================================================
// Phase 2: Create Source Node
// ============================================================================

async function phase2_createSource(state: PipelineState): Promise<string> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 2: Create Source Node');
  console.log('='.repeat(80));
  console.log('📦 Creating Source node (mocked)\n');

  const sourceEntityKey = `source_${state.conversationId}_${state.userId}`;

  const mockSource = {
    entity_key: sourceEntityKey,
    user_id: state.userId,
    description: state.summary,
    content: { type: state.sourceType, content: state.transcript },
    created_at: new Date().toISOString(),
  };

  console.log(`✅ Created Source node: ${sourceEntityKey}\n`);

  const outputPath = path.join(CONFIG.outputDir, 'pipeline-phase2-source.json');
  fs.writeFileSync(outputPath, JSON.stringify(mockSource, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);

  return sourceEntityKey;
}

// ============================================================================
// Phase 3: Collect Updates
// ============================================================================

async function phase3_collectUpdates(state: PipelineState): Promise<NodeWithUpdates[]> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 3: Collect Updates');
  console.log('='.repeat(80));
  console.log('📝 Collecting rich textual updates for each entity\n');

  const nodesWithUpdates: NodeWithUpdates[] = [];
  const timestamp = new Date().toISOString();

  const extractedEntitiesSummary = state.entities
    .map((e) => {
      const subpointsStr =
        e.subpoints && e.subpoints.length > 0 ? `\n  Subpoints: ${e.subpoints.map((sp) => `"${sp}"`).join(', ')}` : '';
      return `- ${e.name} (${e.entity_type})${subpointsStr}`;
    })
    .join('\n');

  const userPrompt = `
## Conversation Transcript

${state.transcript}

## Extracted Entities (from Phase 1)

${extractedEntitiesSummary}

## Task

For each extracted entity, write a comprehensive textual update summarizing ALL information about it from the transcript.

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
`;

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [new SystemMessage(UPDATE_COLLECTION_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  const maxIterations = 15;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n[${'─'.repeat(76)}]`);
    console.log(`  Iteration ${iteration}/${maxIterations}`);
    console.log(`[${'─'.repeat(76)}]\n`);

    const response = await model.invoke(messages, { tools: phase3Tools });
    messages.push(response);

    const aiMsg = response as AIMessage;
    if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
      console.log('✅ Update collection complete\n');
      break;
    }

    console.log(`📞 Tool calls: ${aiMsg.tool_calls.length}`);
    aiMsg.tool_calls.forEach((toolCall, idx) => {
      console.log(`\n  ${idx + 1}. ${toolCall.name}`);
      console.log(`     identifier: ${toolCall.args.identifier || toolCall.args.entity_key}`);
      console.log(`     update: ${(toolCall.args.update as string).substring(0, 100)}...`);

      let result: Record<string, unknown>;

      if (toolCall.name === 'createNodeWithUpdate') {
        const node: NodeWithUpdates = {
          identifier: toolCall.args.identifier as string,
          entity_type: toolCall.args.entity_type as 'Person' | 'Concept' | 'Entity',
          updates: [
            {
              content: toolCall.args.update as string,
              timestamp,
              source_id: state.sourceEntityKey,
              processed: false,
            },
          ],
        };
        nodesWithUpdates.push(node);
        result = { success: true };
      } else if (toolCall.name === 'updateNodeWithUpdate') {
        const node = nodesWithUpdates.find((n) => n.entity_key === toolCall.args.entity_key);
        if (node) {
          node.updates.push({
            content: toolCall.args.update as string,
            timestamp,
            source_id: state.sourceEntityKey,
            processed: false,
          });
        }
        result = { success: true };
      } else {
        result = { success: false, error: 'Unknown tool' };
      }

      const toolMessage = new ToolMessage({
        content: JSON.stringify(result),
        tool_call_id: toolCall.id || `tool_${Date.now()}`,
      });
      messages.push(toolMessage);
    });
  }

  if (iteration >= maxIterations) {
    console.log('⚠️  Reached max iterations\n');
  }

  console.log(`✅ Collected updates for ${nodesWithUpdates.length} nodes\n`);

  const outputPath = path.join(CONFIG.outputDir, 'pipeline-phase3-updates.json');
  fs.writeFileSync(outputPath, JSON.stringify(nodesWithUpdates, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);

  return nodesWithUpdates;
}

// ============================================================================
// Phase 4: Process Updates (3 Parallel Agents)
// ============================================================================

async function phase4_processUpdates(state: PipelineState): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 4: Process Updates');
  console.log('='.repeat(80));
  console.log('🤖 Running 3 specialized agents in parallel\n');

  const personNodes = state.nodesWithUpdates.filter((n) => n.entity_type === 'Person');
  const conceptNodes = state.nodesWithUpdates.filter((n) => n.entity_type === 'Concept');
  const entityNodes = state.nodesWithUpdates.filter((n) => n.entity_type === 'Entity');

  console.log(`📊 Distribution:`);
  console.log(`  - Person nodes: ${personNodes.length}`);
  console.log(`  - Concept nodes: ${conceptNodes.length}`);
  console.log(`  - Entity nodes: ${entityNodes.length}\n`);

  // Run agents in parallel
  const results = await Promise.all([
    processPersonNodes(personNodes, state),
    processConceptNodes(conceptNodes, state),
    processEntityNodes(entityNodes, state),
  ]);

  console.log(`\n✅ All agents complete\n`);
}

async function processPersonNodes(nodes: NodeWithUpdates[], state: PipelineState): Promise<void> {
  if (nodes.length === 0) {
    console.log('⏭️  No Person nodes to process\n');
    return;
  }

  console.log(`\n[${'─'.repeat(76)}]`);
  console.log(`  Person Agent`);
  console.log(`[${'─'.repeat(76)}]\n`);

  const nodesSummary = nodes
    .map((n) => {
      const updatesStr = n.updates.map((u) => `  - ${u.content}`).join('\n');
      return `### ${n.identifier} (Person)\n\n${updatesStr}`;
    })
    .join('\n\n');

  const userPrompt = `
## Nodes with Updates

${nodesSummary}

## Task

Process each Person node above:
1. Extract structured properties from updates (situation, personality, etc.)
2. Create User→Person relationships (has_relationship_with)
3. Create any Concept→Person relationships if concepts involve these people

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
`;

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [new SystemMessage(PERSON_PROCESSING_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  await runProcessingAgent(model, messages, phase4Tools, mockNeo4j, 'Person');
}

async function processConceptNodes(nodes: NodeWithUpdates[], state: PipelineState): Promise<void> {
  if (nodes.length === 0) {
    console.log('⏭️  No Concept nodes to process\n');
    return;
  }

  console.log(`\n[${'─'.repeat(76)}]`);
  console.log(`  Concept Agent`);
  console.log(`[${'─'.repeat(76)}]\n`);

  const nodesSummary = nodes
    .map((n) => {
      const updatesStr = n.updates.map((u) => `  - ${u.content}`).join('\n');
      return `### ${n.identifier} (Concept)\n\n${updatesStr}`;
    })
    .join('\n\n');

  const userPrompt = `
## Nodes with Updates

${nodesSummary}

## Task

Process each Concept node above:
1. Extract structured properties from updates (description, notes)
2. Create User→Concept relationships (thinks_about)
3. Create Concept→Concept relationships (relates_to)
4. Create Concept→Person/Entity relationships (involves)

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
`;

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [new SystemMessage(CONCEPT_PROCESSING_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  await runProcessingAgent(model, messages, phase4Tools, mockNeo4j, 'Concept');
}

async function processEntityNodes(nodes: NodeWithUpdates[], state: PipelineState): Promise<void> {
  if (nodes.length === 0) {
    console.log('⏭️  No Entity nodes to process\n');
    return;
  }

  console.log(`\n[${'─'.repeat(76)}]`);
  console.log(`  Entity Agent`);
  console.log(`[${'─'.repeat(76)}]\n`);

  const nodesSummary = nodes
    .map((n) => {
      const updatesStr = n.updates.map((u) => `  - ${u.content}`).join('\n');
      return `### ${n.identifier} (Entity)\n\n${updatesStr}`;
    })
    .join('\n\n');

  const userPrompt = `
## Nodes with Updates

${nodesSummary}

## Task

Process each Entity node above:
1. Extract structured properties from updates (type, description, notes)
2. Create User→Entity relationships (relates_to)
3. Create Concept→Entity relationships (involves)
4. Create Entity→Entity relationships (relates_to)

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
`;

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [new SystemMessage(ENTITY_PROCESSING_SYSTEM_PROMPT), new HumanMessage(userPrompt)];

  await runProcessingAgent(model, messages, phase4Tools, mockNeo4j, 'Entity');
}

interface ToolDefinition {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

async function runProcessingAgent(
  model: ChatOpenAI,
  messages: BaseMessage[],
  tools: ToolDefinition[],
  neo4j: MockNeo4j,
  agentType: string
): Promise<void> {
  const maxIterations = 10;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`  Iteration ${iteration}/${maxIterations}`);

    const response = await model.invoke(messages, { tools });
    messages.push(response);

    const aiMsg = response as AIMessage;
    if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
      console.log(`  ✅ ${agentType} agent complete\n`);
      break;
    }

    console.log(`  📞 Tool calls: ${aiMsg.tool_calls.length}`);
    aiMsg.tool_calls.forEach((toolCall) => {
      let result: Record<string, unknown>;

      switch (toolCall.name) {
        case 'createPerson':
          result = neo4j.createPerson(toolCall.args);
          break;
        case 'updatePerson':
          result = neo4j.updatePerson(toolCall.args);
          break;
        case 'createConcept':
          result = neo4j.createConcept(toolCall.args);
          break;
        case 'updateConcept':
          result = neo4j.updateConcept(toolCall.args);
          break;
        case 'createEntity':
          result = neo4j.createEntity(toolCall.args);
          break;
        case 'updateEntity':
          result = neo4j.updateEntity(toolCall.args);
          break;
        case 'createRelationship':
          result = neo4j.createRelationship(toolCall.args);
          break;
        case 'updateRelationship':
          result = neo4j.updateRelationship(toolCall.args);
          break;
        default:
          result = { success: false, error: 'Unknown tool' };
      }

      const toolMessage = new ToolMessage({
        content: JSON.stringify(result),
        tool_call_id: toolCall.id || `tool_${Date.now()}`,
      });
      messages.push(toolMessage);
    });
  }

  if (iteration >= maxIterations) {
    console.log(`  ⚠️  ${agentType} agent reached max iterations\n`);
  }
}

// ============================================================================
// Main Pipeline Runner
// ============================================================================

async function runPipeline() {
  console.log('🧪 Ingestion Pipeline - New Architecture\n');
  console.log('Configuration:');
  console.log(`  Conversation ID: ${CONFIG.conversationId}`);
  console.log(`  User ID: ${CONFIG.userId}`);
  console.log(`  Source Type: ${CONFIG.sourceType}`);
  console.log(`  Sample Data: ${CONFIG.sampleDataPath}`);
  console.log(`  Phase Range: ${CONFIG.startPhase} → ${CONFIG.maxPhase}\n`);

  const transcript = fs.readFileSync(CONFIG.sampleDataPath, 'utf-8');
  const summary = 'Test conversation about personal interests and relationships';

  const state: PipelineState = {
    conversationId: CONFIG.conversationId,
    userId: CONFIG.userId,
    transcript,
    summary,
    sourceType: CONFIG.sourceType,
    entities: [],
    sourceEntityKey: '',
    nodesWithUpdates: [],
  };

  try {
    // Phase 0
    if (CONFIG.startPhase <= 0 && CONFIG.maxPhase >= 0) {
      state.transcript = await phase0_convertToNotes(state);
      if (CONFIG.maxPhase === 0) {
        console.log('\n⏹️  Stopping after Phase 0\n');
        return;
      }
    }

    // Phase 1
    if (CONFIG.startPhase <= 1 && CONFIG.maxPhase >= 1) {
      state.entities = await phase1_extractEntities(state.transcript);
      if (CONFIG.maxPhase === 1) {
        console.log('\n⏹️  Stopping after Phase 1\n');
        return;
      }
    }

    // Phase 2
    if (CONFIG.startPhase <= 2 && CONFIG.maxPhase >= 2) {
      state.sourceEntityKey = await phase2_createSource(state);
      if (CONFIG.maxPhase === 2) {
        console.log('\n⏹️  Stopping after Phase 2\n');
        return;
      }
    }

    // Phase 3
    if (CONFIG.startPhase <= 3 && CONFIG.maxPhase >= 3) {
      state.nodesWithUpdates = await phase3_collectUpdates(state);
      if (CONFIG.maxPhase === 3) {
        console.log('\n⏹️  Stopping after Phase 3\n');
        return;
      }
    }

    // Phase 4
    if (CONFIG.startPhase <= 4 && CONFIG.maxPhase >= 4) {
      await phase4_processUpdates(state);
    }

    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ PIPELINE COMPLETE');
    console.log('='.repeat(80));
    console.log('\nSummary:');
    console.log(`  Phases run: ${CONFIG.startPhase} → ${CONFIG.maxPhase}`);
    if (CONFIG.maxPhase >= 1) console.log(`  Entities extracted: ${state.entities.length}`);
    if (CONFIG.maxPhase >= 3) console.log(`  Nodes with updates: ${state.nodesWithUpdates.length}`);
    if (CONFIG.maxPhase >= 4) {
      console.log(`  Nodes created: ${mockNeo4j.nodes.length}`);
      console.log(`  Relationships created: ${mockNeo4j.relationships.length}`);
    }

    // Save Phase 4 output
    if (CONFIG.maxPhase >= 4) {
      const graphState = {
        nodes: mockNeo4j.nodes,
        relationships: mockNeo4j.relationships,
      };
      const outputPath = path.join(CONFIG.outputDir, 'pipeline-phase4-graph.json');
      fs.writeFileSync(outputPath, JSON.stringify(graphState, null, 2));
      console.log(`\n💾 Final graph saved to: ${outputPath}`);
    }

    console.log('\n✅ Test completed successfully');
  } catch (error) {
    console.error('\n❌ Pipeline failed:', error);
    throw error;
  }
}

runPipeline()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

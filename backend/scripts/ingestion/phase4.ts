import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import {
  CONCEPT_PROCESSING_SYSTEM_PROMPT,
  ENTITY_PROCESSING_SYSTEM_PROMPT,
  PERSON_PROCESSING_SYSTEM_PROMPT,
} from '../../src/agents/prompts/ingestion/index.js';
import {
  personIngestionTools,
  conceptIngestionTools,
  entityIngestionTools,
} from '../../src/agents/tools/registry.js';
import { MockNeo4j } from './mock-neo4j.js';
import { NodeWithUpdates, PipelineConfig, PipelineState } from './types.js';

/**
 * Phase 4: Process updates into structured nodes and relationships
 *
 * Three specialized agents run in parallel, each with custom relationship tools:
 *
 * - Person agent:
 *   - Node tools: createPerson, updatePerson
 *   - Relationship tools: createPersonThinksAboutConcept, createPersonRelationship, createPersonRelatesToEntity
 *
 * - Concept agent:
 *   - Node tools: createConcept, updateConcept
 *   - Relationship tools: createConceptRelatesToConcept, createConceptInvolvesPerson, createConceptInvolvesEntity
 *
 * - Entity agent:
 *   - Node tools: createEntity, updateEntity
 *   - Relationship tools: createEntityRelatesToEntity
 *
 * Each agent only sees relationship types it can create.
 * Frequency is auto-managed (increments on each mention).
 * Relevance is 1-5 scale.
 *
 * Tools are imported from backend/src/agents/tools/registry.ts:
 * - personIngestionTools
 * - conceptIngestionTools
 * - entityIngestionTools
 */

// ============================================================================
// Agent Processing Functions
// ============================================================================

async function processPersonNodes(
  nodes: NodeWithUpdates[],
  state: PipelineState,
  neo4j: MockNeo4j,
  config: PipelineConfig
): Promise<void> {
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

  await runProcessingAgent(model, messages, personIngestionTools, neo4j, 'Person', state, config);
}

async function processConceptNodes(
  nodes: NodeWithUpdates[],
  state: PipelineState,
  neo4j: MockNeo4j,
  config: PipelineConfig
): Promise<void> {
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

  await runProcessingAgent(model, messages, conceptIngestionTools, neo4j, 'Concept', state, config);
}

async function processEntityNodes(
  nodes: NodeWithUpdates[],
  state: PipelineState,
  neo4j: MockNeo4j,
  config: PipelineConfig
): Promise<void> {
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

  await runProcessingAgent(model, messages, entityIngestionTools, neo4j, 'Entity', state, config);
}

// ============================================================================
// Agent Loop
// ============================================================================

async function runProcessingAgent(
  model: ChatOpenAI,
  messages: BaseMessage[],
  tools: StructuredToolInterface[],
  neo4j: MockNeo4j,
  agentType: string,
  state: PipelineState,
  config: PipelineConfig
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

      // Auto-populate last_update_source and confidence
      const args = { ...toolCall.args };

      // Find entity from Phase 1 to get confidence
      if (toolCall.name.startsWith('create')) {
        const identifier = (args.canonical_name || args.name) as string | undefined;
        let confidence = 0.8; // Default if no match found

        if (identifier) {
          const entity = state.entities.find((e) => e.name.toLowerCase() === identifier.toLowerCase());
          if (entity) {
            confidence = entity.confidence / 10;
          }
        }

        args.last_update_source = state.conversationId;
        args.confidence = confidence;
      }

      switch (toolCall.name) {
        // Node tools
        case 'createPerson':
        case 'create_person':
          result = neo4j.createPerson(args);
          break;
        case 'updatePerson':
          result = neo4j.updatePerson(args);
          break;
        case 'createConcept':
          result = neo4j.createConcept(args);
          break;
        case 'updateConcept':
          result = neo4j.updateConcept(args);
          break;
        case 'createEntity':
          result = neo4j.createEntity(args);
          break;
        case 'updateEntity':
          result = neo4j.updateEntity(args);
          break;

        // Person relationship tools
        case 'createPersonThinksAboutConcept':
          result = neo4j.createRelationship({
            from_entity_key: args.person_entity_key,
            to_entity_key: args.concept_entity_key,
            relationship_type: 'thinks_about',
            properties: { mood: args.mood },
          });
          break;
        case 'createPersonRelationship':
          result = neo4j.createRelationship({
            from_entity_key: args.from_person_entity_key,
            to_entity_key: args.to_person_entity_key,
            relationship_type: 'has_relationship_with',
            properties: {
              attitude_towards_person: args.attitude_towards_person,
              closeness: args.closeness,
              relationship_type: args.relationship_type,
              notes: args.notes,
            },
          });
          break;
        case 'createPersonRelatesToEntity':
          result = neo4j.createRelationship({
            from_entity_key: args.person_entity_key,
            to_entity_key: args.entity_entity_key,
            relationship_type: 'relates_to_entity',
            properties: {
              relationship_type: args.relationship_type,
              notes: args.notes,
              relevance: args.relevance,
            },
          });
          break;

        // Concept relationship tools
        case 'createConceptRelatesToConcept':
          result = neo4j.createRelationship({
            from_entity_key: args.from_concept_entity_key,
            to_entity_key: args.to_concept_entity_key,
            relationship_type: 'relates_to_concept',
            properties: { notes: args.notes, relevance: args.relevance },
          });
          break;
        case 'createConceptInvolvesPerson':
          result = neo4j.createRelationship({
            from_entity_key: args.concept_entity_key,
            to_entity_key: args.person_entity_key,
            relationship_type: 'involves_person',
            properties: { notes: args.notes, relevance: args.relevance },
          });
          break;
        case 'createConceptInvolvesEntity':
          result = neo4j.createRelationship({
            from_entity_key: args.concept_entity_key,
            to_entity_key: args.entity_entity_key,
            relationship_type: 'involves_entity',
            properties: { notes: args.notes, relevance: args.relevance },
          });
          break;

        // Entity relationship tools
        case 'createEntityRelatesToEntity':
          result = neo4j.createRelationship({
            from_entity_key: args.from_entity_entity_key,
            to_entity_key: args.to_entity_entity_key,
            relationship_type: 'relates_to_entity_entity',
            properties: {
              relationship_type: args.relationship_type,
              notes: args.notes,
              relevance: args.relevance,
            },
          });
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
// Main Phase 4 Function
// ============================================================================

export async function runPhase4(state: PipelineState, config: PipelineConfig, neo4j: MockNeo4j): Promise<void> {
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
  await Promise.all([
    processPersonNodes(personNodes, state, neo4j, config),
    processConceptNodes(conceptNodes, state, neo4j, config),
    processEntityNodes(entityNodes, state, neo4j, config),
  ]);

  console.log(`\n✅ All agents complete\n`);

  // Create Episode and Source nodes with relationships
  console.log(`[${'─'.repeat(76)}]`);
  console.log(`  Creating Episode and Source Infrastructure`);
  console.log(`[${'─'.repeat(76)}]\n`);

  // Load Episode data from Phase 2 output
  const sourcePath = path.join(config.outputDir, 'pipeline-phase2-source.json');
  const phase2Data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));

  // Create Source node
  neo4j.createSource(phase2Data.source);
  console.log(`✅ Created Source node: ${phase2Data.source.entity_key}`);

  // Create Episode node
  neo4j.createEpisode(phase2Data.episode);
  console.log(`✅ Created Episode node: ${phase2Data.episode.entity_key}`);

  // Create Episode [includes] Source relationship
  neo4j.createRelationship({
    from_entity_key: phase2Data.episode.entity_key,
    to_entity_key: phase2Data.source.entity_key,
    relationship_type: 'includes',
    properties: {},
  });
  console.log(`✅ Created Episode [includes] Source relationship`);

  // Create Episode [involves] relationships for all extracted entities
  console.log(`\n📎 Linking Episode to extracted entities:`);

  // Create Episode [involves] Person relationships
  const personEntityKeys = neo4j.nodes
    .filter((n) => n.type === 'Person')
    .map((n) => n.entity_key);

  personEntityKeys.forEach((entityKey) => {
    neo4j.createRelationship({
      from_entity_key: phase2Data.episode.entity_key,
      to_entity_key: entityKey,
      relationship_type: 'involves_person',
      properties: { relevance: 5 }, // Default relevance, could be enhanced with LLM scoring
    });
  });
  console.log(`  - Created ${personEntityKeys.length} Episode [involves] Person relationships`);

  // Create Episode [involves] Concept relationships
  const conceptEntityKeys = neo4j.nodes
    .filter((n) => n.type === 'Concept')
    .map((n) => n.entity_key);

  conceptEntityKeys.forEach((entityKey) => {
    neo4j.createRelationship({
      from_entity_key: phase2Data.episode.entity_key,
      to_entity_key: entityKey,
      relationship_type: 'involves_concept',
      properties: { relevance: 5 },
    });
  });
  console.log(`  - Created ${conceptEntityKeys.length} Episode [involves] Concept relationships`);

  // Create Episode [involves] Entity relationships
  const entityEntityKeys = neo4j.nodes
    .filter((n) => n.type === 'Entity')
    .map((n) => n.entity_key);

  entityEntityKeys.forEach((entityKey) => {
    neo4j.createRelationship({
      from_entity_key: phase2Data.episode.entity_key,
      to_entity_key: entityKey,
      relationship_type: 'involves_entity',
      properties: { relevance: 5 },
    });
  });
  console.log(`  - Created ${entityEntityKeys.length} Episode [involves] Entity relationships\n`);

  // Save graph output
  const graphOutput = {
    nodes: neo4j.nodes,
    relationships: neo4j.relationships,
  };

  const outputPath = path.join(config.outputDir, 'pipeline-phase4-graph.json');
  fs.writeFileSync(outputPath, JSON.stringify(graphOutput, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);
}

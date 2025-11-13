import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { RELATIONSHIP_PROCESSING_SYSTEM_PROMPT } from '../../src/agents/prompts/ingestion/index.js';
import { ingestionTools } from '../../src/agents/tools/registry.js';
import { neo4jService } from '../../src/db/neo4j.js';
import { embeddingGenerationService } from '../../src/services/embeddingGenerationService.js';
import { PipelineConfig, PipelineState } from './types.js';

/**
 * Generate embeddings for newly created nodes
 *
 * Queries Neo4j for node descriptions + notes, generates embeddings in batch,
 * and updates nodes with embeddings.
 */
async function generateEmbeddingsForNodes(entityKeys: string[]): Promise<void> {
  if (entityKeys.length === 0) return;

  // Fetch node data for embedding
  const query = `
    MATCH (n)
    WHERE n.entity_key IN $entity_keys
    RETURN
      n.entity_key AS entity_key,
      labels(n)[0] AS label,
      n.description AS description,
      n.notes AS notes
  `;

  interface NodeData {
    entity_key: string;
    label: string;
    description: string | null;
    notes: string | null;
  }

  const nodes = await neo4jService.executeQuery<NodeData>(query, { entity_keys: entityKeys });

  // Prepare texts for embedding (description + notes)
  const embeddingData = nodes.map((node) => {
    // Parse notes if it's a JSON string
    let notesText = '';
    if (node.notes) {
      try {
        const notesArray = JSON.parse(node.notes);
        notesText = notesArray.map((n: { content: string }) => n.content).join(' ');
      } catch (e) {
        notesText = node.notes;
      }
    }

    const text = `${node.description || ''} ${notesText}`.trim();
    return {
      entity_key: node.entity_key,
      text,
    };
  });

  // Filter out nodes with no text
  const validData = embeddingData.filter((d) => d.text.length > 0);
  if (validData.length === 0) return;

  // Batch generate embeddings
  const texts = validData.map((d) => d.text);
  const embeddings = await embeddingGenerationService.batchEmbed(texts);

  // Update nodes with embeddings
  for (let i = 0; i < validData.length; i++) {
    const updateQuery = `
      MATCH (n {entity_key: $entity_key})
      SET n.embedding = $embedding
    `;
    await neo4jService.executeQuery(updateQuery, {
      entity_key: validData[i].entity_key,
      embedding: embeddings[i],
    });
  }
}

/**
 * Phase 4: Create Nodes and Relationships
 *
 * Single unified agent with all ingestion tools:
 * - Node tools: createPerson, updatePerson, createConcept, updateConcept, createEntity, updateEntity
 * - Note tools: addNoteToPerson, addNoteToConcept, addNoteToEntity
 * - Relationship tools: createRelationship, updateRelationship
 *
 * Agent processes all extracted entities and creates nodes + relationships.
 * Uses real Neo4j via repository tools (not mock).
 *
 * Removes Episode concept entirely (not in documented architecture).
 */

async function runRelationshipAgent(
  state: PipelineState,
  config: PipelineConfig
): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 4: Create Nodes and Relationships');
  console.log('='.repeat(80));
  console.log('🤖 Running unified ingestion agent\n');

  // Prepare entity summary for agent
  const entitySummary = state.entities
    .map((e) => {
      const subpointsStr = e.subpoints.map((sp) => `  - ${sp}`).join('\n');
      return `### ${e.name} (${e.entity_type}) [confidence: ${(e.confidence * 10).toFixed(1)}/10]\n\n${subpointsStr}`;
    })
    .join('\n\n');

  const userPrompt = `
## Transcript

${state.transcript}

## Summary

${state.summary}

## Extracted Entities

${entitySummary}

## Task

Process the above transcript and extracted entities:

1. **Create or update nodes** for each entity using create/update tools
   - Use entity names and subpoints to populate node properties
   - Set last_update_source to conversation_id: ${state.conversationId}
   - Use confidence values from extraction (already normalized 0-1)

2. **Create relationships** between nodes using createRelationship tool
   - Person→Concept: thinks_about (with mood)
   - Person→Person: has_relationship_with (with attitude, closeness, relationship_type, notes)
   - Concept→Concept: relates_to (with notes, relevance)
   - Concept→Person: involves (with notes, relevance)
   - Concept→Entity: involves (with notes, relevance)
   - Person→Entity: relates_to (with relationship_type, notes, relevance)
   - Entity→Entity: relates_to (with relationship_type, notes, relevance)

3. **Add notes** to nodes when you have unstructured information using addNoteTo* tools

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
- source_entity_key: ${state.sourceEntityKey}

**Important**: Only create nodes/relationships when there is meaningful information in the transcript. Don't create entities for casual mentions without context.
`;

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [
    new SystemMessage(RELATIONSHIP_PROCESSING_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ];

  const maxIterations = 10;
  let iteration = 0;
  const createdNodes: string[] = []; // Track entity_keys of created nodes for embedding generation

  console.log(`📊 Starting agent with ${ingestionTools.length} available tools\n`);

  while (iteration < maxIterations) {
    iteration++;
    console.log(`  Iteration ${iteration}/${maxIterations}`);

    const response = await model.invoke(messages, { tools: ingestionTools });
    messages.push(response);

    const aiMsg = response as AIMessage;
    if (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0) {
      console.log(`  ✅ Agent complete - no more tool calls\n`);
      break;
    }

    console.log(`  📞 Tool calls: ${aiMsg.tool_calls.length}`);

    // Process tool calls
    for (const toolCall of aiMsg.tool_calls) {
      console.log(`     - ${toolCall.name}`);

      // Find the tool and invoke it
      const tool = ingestionTools.find((t) => t.name === toolCall.name);
      if (!tool) {
        const errorResult = JSON.stringify({
          success: false,
          error: `Unknown tool: ${toolCall.name}`,
        });
        messages.push(
          new ToolMessage({
            content: errorResult,
            tool_call_id: toolCall.id || `tool_${Date.now()}`,
          })
        );
        continue;
      }

      try {
        // Auto-populate user_id for create operations if not provided
        const args = { ...toolCall.args };
        if (toolCall.name.startsWith('create') && !args.user_id && !args.entity_key) {
          args.user_id = state.userId;
        }

        // Auto-populate last_update_source and confidence for create operations
        if (toolCall.name.startsWith('create') && !args.last_update_source) {
          args.last_update_source = state.conversationId;

          // Try to find matching entity from extraction for confidence
          if (!args.confidence) {
            const identifier = (args.canonical_name || args.name) as string | undefined;
            if (identifier) {
              const entity = state.entities.find((e) => e.name.toLowerCase() === identifier.toLowerCase());
              if (entity) {
                args.confidence = entity.confidence; // Already normalized 0-1
              } else {
                args.confidence = 0.8; // Default if no match found
              }
            }
          }
        }

        // Invoke tool
        const result = await (tool as StructuredTool).invoke(args);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

        // Track created nodes for embedding generation
        // Check response metadata instead of tool name (more reliable)
        try {
          const resultObj = JSON.parse(resultStr);
          if (
            resultObj.success &&
            resultObj.entity_key &&
            resultObj.entity_type &&
            ['Person', 'Concept', 'Entity'].includes(resultObj.entity_type)
          ) {
            createdNodes.push(resultObj.entity_key);
          }
        } catch (e) {
          // Ignore parse errors
        }

        messages.push(
          new ToolMessage({
            content: resultStr,
            tool_call_id: toolCall.id || `tool_${Date.now()}`,
          })
        );
      } catch (error) {
        const errorResult = JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        messages.push(
          new ToolMessage({
            content: errorResult,
            tool_call_id: toolCall.id || `tool_${Date.now()}`,
          })
        );
      }
    }
  }

  if (iteration >= maxIterations) {
    console.log(`  ⚠️  Agent reached max iterations\n`);
  }

  // Generate embeddings for created nodes
  if (createdNodes.length > 0) {
    console.log(`\n🔢 Generating embeddings for ${createdNodes.length} created nodes...`);
    await generateEmbeddingsForNodes(createdNodes);
    console.log(`✅ Embeddings generated\n`);
  }

  // Save agent messages for debugging
  const outputPath = path.join(config.outputDir, 'pipeline-phase4-graph.json');
  const outputData = {
    messages: messages.map((m) => ({
      type: m._getType(),
      content: m.content,
      tool_calls: 'tool_calls' in m ? (m as AIMessage).tool_calls : undefined,
    })),
    iterations: iteration,
    completed: iteration < maxIterations,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`💾 Saved agent output to: ${outputPath}\n`);
}

export async function runPhase4(state: PipelineState, config: PipelineConfig): Promise<void> {
  await runRelationshipAgent(state, config);
  console.log(`✅ Phase 4 complete\n`);
}

import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { StructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { RELATIONSHIP_PROCESSING_SYSTEM_PROMPT } from '../../src/agents/prompts/ingestion/index.js';
import { neo4jService } from '../../src/db/neo4j.js';
import { embeddingGenerationService } from '../../src/services/embeddingGenerationService.js';
import { PipelineConfig, PipelineState, type Phase4Output } from './types.js';
import { createExploreTool } from '../../src/agents/tools/retrieval/explore.tool.js';
import { createTraverseTool } from '../../src/agents/tools/retrieval/traverse.tool.js';
import { createNodeTool, updateNodeTool } from '../../src/agents/tools/ingestion/generic.tool.js';
import { createRelationshipTool } from '../../src/agents/tools/relationships/relationship.tool.js';
import { updateRelationshipTool } from '../../src/agents/tools/ingestion/generic.tool.js';

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
 * Single unified agent with 6 generic tools:
 * 1. explore - Search graph for existing nodes (semantic + fuzzy)
 * 2. traverse - Navigate graph with custom Cypher queries
 * 3. createNode - Create Person/Concept/Entity nodes
 * 4. updateNode - Add notes to any existing node
 * 5. createRelationship - Create typed relationships
 * 6. updateRelationship - Update relationship properties
 *
 * Agent workflow for each entity:
 * 1. Use explore to search for existing matching nodes
 * 2. If found → updateNode to add new notes
 * 3. If not found → createNode to create it
 * 4. Use createRelationship/updateRelationship to connect adjacent nodes
 */

async function runRelationshipAgent(
  state: PipelineState,
  config: PipelineConfig
): Promise<Phase4Output> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 4: Create Nodes and Relationships');
  console.log('='.repeat(80));
  console.log('🤖 Running unified ingestion agent with 6 generic tools\n');

  // Prepare entity summary for agent
  const entitySummary = state.entities
    .map((e) => {
      const subpointsStr = e.subpoints.map((sp) => `  - ${sp}`).join('\n');
      return `### ${e.name} (${e.entity_type}) [confidence: ${e.confidence}/10]\n\n${subpointsStr}`;
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

Process the above transcript and extracted entities using the following workflow:

**For each entity:**

1. **Explore** - Use the explore tool to search for existing matching nodes
   - Use text_matches for exact name matching
   - Use queries for semantic similarity search
   - Look for matches by canonical_name (Person), name (Concept/Entity)

2. **Create or Update**
   - **If matching node found** → Use update_node tool to add notes about new information
   - **If no match found** → Use create_node tool to create new node
     - Set node_type appropriately (Person, Concept, Entity)
     - Use entity names and subpoints to populate properties
     - Set last_update_source to: ${state.conversationId}
     - Set confidence from extraction (0-1 scale, already provided)

3. **Connect** - Use create_relationship or update_relationship tools to connect nodes
   - Create relationships between entities that interact or relate to each other
   - Relationship types are automatically determined by node types
   - Set appropriate attitude (1-5) and proximity (1-5) scores
   - Add descriptive relationship_type and description

Context:
- conversation_id: ${state.conversationId}
- user_id: ${state.userId}
- source_entity_key: ${state.sourceEntityKey}

**Important**: Only create nodes when there is meaningful user-specific information. Use explore thoroughly before creating to avoid duplicates.
`;

  // Create tools bound to user_id
  const exploreTool = createExploreTool(state.userId);
  const traverseTool = createTraverseTool(state.userId);

  const tools = [exploreTool, traverseTool, createNodeTool, updateNodeTool, createRelationshipTool, updateRelationshipTool];

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const messages: BaseMessage[] = [
    new SystemMessage(RELATIONSHIP_PROCESSING_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ];

  const maxIterations = 15; // Increased for explore workflow
  let iteration = 0;
  const createdNodes: string[] = []; // Track entity_keys of created nodes for embedding generation

  console.log(`📊 Starting agent with 6 generic tools\n`);

  while (iteration < maxIterations) {
    iteration++;
    console.log(`  Iteration ${iteration}/${maxIterations}`);

    const response = await model.invoke(messages, { tools });
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
      const tool = tools.find((t) => t.name === toolCall.name);
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
        // Auto-populate context parameters
        const args = { ...toolCall.args };

        // create_node: Auto-populate user_id, last_update_source, source_entity_key
        if (toolCall.name === 'create_node') {
          if (!args.user_id) args.user_id = state.userId;
          if (!args.last_update_source) args.last_update_source = state.conversationId;
          if (!args.source_entity_key) args.source_entity_key = state.sourceEntityKey;

          // Auto-populate confidence from extraction if not provided
          if (!args.confidence) {
            const identifier = (args.canonical_name || args.name) as string | undefined;
            if (identifier) {
              const entity = state.entities.find((e) => e.name.toLowerCase() === identifier.toLowerCase());
              if (entity) {
                args.confidence = entity.confidence / 10; // Convert from 1-10 to 0-1
              } else {
                args.confidence = 0.8; // Default
              }
            }
          }
        }

        // update_node: Auto-populate added_by, source_entity_key
        if (toolCall.name === 'update_node') {
          if (!args.added_by) args.added_by = state.userId;
          if (!args.source_entity_key) args.source_entity_key = state.sourceEntityKey;
        }

        // Invoke tool
        const result = await (tool as StructuredTool).invoke(args);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

        // Track created nodes for embedding generation
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
  const outputDataForFile = {
    messages: messages.map((m) => ({
      type: m._getType(),
      content: m.content,
      tool_calls: 'tool_calls' in m ? (m as AIMessage).tool_calls : undefined,
    })),
    iterations: iteration,
    completed: iteration < maxIterations,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputDataForFile, null, 2));
  console.log(`💾 Saved agent output to: ${outputPath}\n`);

  // Return Phase4Output with actual BaseMessage[] array
  const outputData: Phase4Output = {
    messages: messages,
    iterations: iteration,
    completed: iteration < maxIterations,
  };

  return outputData;
}

export async function runPhase4(state: PipelineState, config: PipelineConfig): Promise<Phase4Output> {
  const result = await runRelationshipAgent(state, config);
  console.log(`✅ Phase 4 complete\n`);
  return result;
}

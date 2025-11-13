import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { UPDATE_COLLECTION_SYSTEM_PROMPT } from "../../src/agents/prompts/ingestion/index.js";
import { NodeWithUpdates, PipelineConfig, PipelineState } from './types.js';

/**
 * Phase 3: Collect rich textual updates for each entity
 *
 * Agent writes comprehensive updates for each extracted entity.
 * Updates are stored on nodes to be processed in Phase 4.
 */

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

export async function runPhase3(state: PipelineState, config: PipelineConfig): Promise<NodeWithUpdates[]> {
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

  const outputPath = path.join(config.outputDir, 'pipeline-phase3-updates.json');
  fs.writeFileSync(outputPath, JSON.stringify(nodesWithUpdates, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);

  return nodesWithUpdates;
}

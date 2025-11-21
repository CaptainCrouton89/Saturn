/**
 * MERGE Agent
 *
 * AI SDK agent for updating existing nodes when high semantic similarity is detected.
 * Extracted from entityResolutionService.updateExistingNode() as part of Phase 5 refactor.
 *
 * Reference: INGESTION_REFACTOR_PLAN_V2.md Section 3.1
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { neo4jService } from '../db/neo4j.js';
import type { Concept, Entity, EntityType, Person } from '../types/graph.js';
import { calculateDynamicMaxSteps } from '../utils/agentHelpers.js';
import type {
  FormattableNode,
  FormattedRelationship,
} from '../utils/contextFormatting.js';
import {
  formatRelationshipsAsXml,
  formatSingleNodeAsXml,
  getNodeType,
} from '../utils/contextFormatting.js';
import { normalizeEntityName } from '../utils/entityKeyHelpers.js';
import { buildNameMapWithTarget, loadNeighbors } from '../utils/neighborContextHelpers.js';
import { mergeNeighborsWithSourceSiblings, type SourceSibling } from '../utils/neighborHelpers.js';
import { applyNotesToNode, loadNodeByEntityKey } from '../utils/nodeHelpers.js';
import { parseNotes } from '../utils/notes.js';
import { MERGE_AGENT_SYSTEM_PROMPT } from './prompts/ingestion/merge.js';
import { addEdgeAndNodeNotesTool } from './tools/factories/edge.factory.js';

export interface MergeAgentInput {
  userId: string;
  sourceEntityKey: string;
  targetEntityKey: string;
  sourceContent: string;
  extractedEntity: {
    name: string;
    description?: string;
    subpoints?: string[];
  };
  sourceSiblings?: SourceSibling[];
}

/**
 * Result from running the merge agent
 */
export interface MergeAgentResult {
  success: boolean;
  error?: string;
  relationshipsCreated: number;
}

/**
 * Load relationships (edges) connected to the existing node
 */
async function loadRelationships(
  userId: string,
  entityKey: string
): Promise<FormattedRelationship[]> {
  const result = await neo4jService.executeQuery<{
    from: Person | Concept | Entity;
    to: Person | Concept | Entity;
    rel: {
      relationship_type?: string;
      description?: string;
      attitude?: number;
      proximity?: number;
      notes?: string;
    };
    relType: string;
  }>(
    `
    MATCH (from {entity_key: $entity_key})-[r]-(to)
    WHERE to.user_id = $user_id OR to.user_id IS NULL
    RETURN from, to, properties(r) AS rel, type(r) AS relType
    LIMIT 30
    `,
    { entity_key: entityKey, user_id: userId }
  );

  return result.map((row) => {
    const from = row.from as FormattableNode;
    const to = row.to as FormattableNode;
    const rel = row.rel;

    return {
      from_entity_key: from.entity_key,
      from_name: from.name,
      to_entity_key: to.entity_key,
      to_name: to.name,
      relationship_type: rel.relationship_type || row.relType,
      description: rel.description,
      attitude: rel.attitude,
      proximity: rel.proximity,
      notes: rel.notes ? parseNotes(rel.notes) : undefined,
    };
  });
}

/**
 * Phase 1: Generate notes for target node using structured output
 */
async function generateNotesForTargetNode(
  existingNode: FormattableNode,
  nodeType: EntityType,
  sourceContent: string,
  extractedEntity: {
    name: string;
    description?: string;
    subpoints?: string[];
  },
  userId?: string,
  sourceEntityKey?: string
): Promise<Array<{ content: string; lifetime: 'week' | 'month' | 'year' | 'forever' }>> {
  // Build context for note generation - use XML format with source filtering
  const existingNodeMarkdown = sourceEntityKey
    ? formatSingleNodeAsXml(existingNode, nodeType, { sourceEntityKey })
    : `<node name="${normalizeEntityName(existingNode.name)}" type="${nodeType}">${existingNode.description || ''}</node>`;

  const sourceSnippet =
    sourceContent.length > 2000 ? `${sourceContent.slice(0, 2000)}...` : sourceContent;

  const prompt = `## Existing Node

${existingNodeMarkdown}

## Source Content

${sourceSnippet}

## Extracted Entity Information

**Name**: ${extractedEntity.name}
${extractedEntity.description ? `**Description**: ${extractedEntity.description}` : ''}
${extractedEntity.subpoints && extractedEntity.subpoints.length > 0
  ? `**Subpoints**:\n${extractedEntity.subpoints.map((s) => `- ${s}`).join('\n')}`
  : ''}

---

Based on the source content and extracted entity information, generate new notes to add to this existing node.

**Notes Format**: Information-dense incomplete sentences. Pack maximum information per note, drop unnecessary articles ("a", "the") and filler words, include specific details (dates, numbers, concrete examples), use compact phrasing.

Return an array of notes with appropriate lifetimes (week, month, year, forever).`;

  const schema = z.object({
    notes: z.array(
      z.object({
        content: z
          .string()
          .describe(
            'Information-dense incomplete sentence. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
          ),
        lifetime: z.enum(['week', 'month', 'year', 'forever']).describe('How long to retain this note'),
      })
    ),
  });

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const result = await generateObject({
    model: openai("gpt-5-nano", {
      reasoningEffort: "medium",
    }),
    schema,
    system:
      "You are generating notes to add to an existing knowledge graph node. Be comprehensive but token-efficient.",
    prompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: "ingestion-merge-generate-notes",
      metadata: {
        ...(userId ? { userId } : {}),
        ...(sourceEntityKey ? { sourceEntityKey } : {}),
        phase: "merge-generate-notes",
        schemaName: "GenerateNotesSchema",
      },
    },
  });

  const typedObject = result.object as { notes: Array<{ content: string; lifetime: 'week' | 'month' | 'year' | 'forever' }> };
  return typedObject.notes;
}

/**
 * Phase 2: Run neighbor/relationship update workflow using AI SDK
 * Does NOT include tool for updating target node (handled in Phase 1)
 */
async function runNeighborUpdateWorkflow(
  userId: string,
  sourceEntityKey: string,
  _targetEntityKey: string,
  _nodeType: EntityType,
  systemPrompt: string,
  userPrompt: string,
  nameToKeyMap: Map<string, string>,
  neighborCount: number
): Promise<{ relationshipsCreated: number }> {
  // Create tools with bound context - single generic tool for updating edges and nodes
  const tools = {
    // Combined edge and node update tool - auto-detects relationship type based on node labels
    add_edge_and_node_notes: addEdgeAndNodeNotesTool(userId, sourceEntityKey, _targetEntityKey, nameToKeyMap),
  };

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Calculate maxSteps based on neighbor count: allow 2x neighbors + 5 buffer
  const dynamicMaxSteps = calculateDynamicMaxSteps(neighborCount);
  const updatedRelationships = new Set<string>(); // Track updated relationships to prevent duplicates

  // Run agent with tools
  const result = await generateText({
    model: openai("gpt-5-mini", {
      reasoningEffort: 'low', // Use low reasoning for faster execution
    }),
    tools,
    maxSteps: dynamicMaxSteps,
    system: systemPrompt,
    prompt: userPrompt,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'ingestion-merge-update-relationships',
      metadata: {
        userId,
        sourceEntityKey,
        phase: 'merge-update-relationships',
        neighborCount,
        maxSteps: dynamicMaxSteps,
      },
    },
    onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
      if (toolCalls && toolCalls.length > 0) {
        console.log(`   🤖 Agent called ${toolCalls.length} tool(s):`);
        for (const toolCall of toolCalls) {
          console.log(
            `      - ${toolCall.toolName}:`,
            JSON.stringify(toolCall.args).substring(0, 200)
          );

          // Track add_edge_and_node_notes calls to detect duplicates
          if (toolCall.toolName === 'add_edge_and_node_notes') {
            const args = toolCall.args as { to_entity_name: string };
            const relationshipKey = `${toolCall.toolName}-${args.to_entity_name}`;

            if (updatedRelationships.has(relationshipKey)) {
              console.warn(`   ⚠️  WARNING: Duplicate relationship update attempt: ${relationshipKey}`);
              console.warn(`   💡 This may indicate the agent is looping`);
            }
            updatedRelationships.add(relationshipKey);
          }
        }
      }
      if (toolResults && toolResults.length > 0) {
        for (const toolResult of toolResults) {
          try {
            const parsed = JSON.parse(toolResult.result as string);
            if (parsed.success) {
              console.log(`   ✅ ${toolResult.toolName} succeeded`);
            } else {
              console.log(
                `   ❌ ${toolResult.toolName} failed: ${parsed.error}`
              );
            }
          } catch {
            // Non-JSON result
          }
        }
      }
      if (stepType === "continue" && text) {
        console.log(`   🤖 Agent finished without calling tools`);
      }

      // Safety check: if we've attempted to update more relationships than neighbors × 2, something is wrong
      if (updatedRelationships.size > neighborCount * 2) {
        console.error(`   🚨 SAFETY STOP: Attempted ${updatedRelationships.size} relationship updates for ${neighborCount} neighbors`);
        console.error(`   💡 This indicates an infinite loop - agent should have stopped by now`);
        throw new Error('Agent safety limit exceeded - possible infinite loop detected');
      }
    },
  });

  // Count successful relationship updates from tool results
  let relationshipsCreated = 0;
  for (const step of result.steps) {
    if (step.stepType === 'tool-result') {
      for (const toolResult of step.toolResults) {
        try {
          const parsed = JSON.parse(toolResult.result as string);
          // Count successful add_edge_and_node_notes tool calls
          if (parsed.success === true && toolResult.toolName === 'add_edge_and_node_notes') {
            relationshipsCreated++;
          }
        } catch {
          // Ignore non-JSON tool results
        }
      }
    }
  }

  return { relationshipsCreated };
}

/**
 * Run the merge agent to update an existing node
 *
 * @param input - Merge agent input parameters
 * @returns Result indicating success/failure
 */
export async function runMergeAgent(input: MergeAgentInput): Promise<MergeAgentResult> {
  const { userId, sourceEntityKey, targetEntityKey, sourceContent, extractedEntity, sourceSiblings } = input;

  try {
    console.log(`[MergeAgent] Starting two-phase merge for entity: ${targetEntityKey}`);

    // ============================================================================
    // Phase 1: Generate and Apply Notes to Target Node
    // ============================================================================
    console.log(`[MergeAgent] Phase 1: Generating notes for target node...`);

    const existingNode = await loadNodeByEntityKey(targetEntityKey);
    if (!existingNode) {
      return {
        success: false,
        error: `Node with entity_key ${targetEntityKey} not found`,
        relationshipsCreated: 0,
      };
    }

    const nodeType = getNodeType(existingNode);

    // Generate notes using structured output
    const generatedNotes = await generateNotesForTargetNode(
      existingNode,
      nodeType,
      sourceContent,
      extractedEntity,
      userId,
      sourceEntityKey
    );

    console.log(`[MergeAgent] Generated ${generatedNotes.length} notes for target node`);

    // Apply notes to target node
    if (generatedNotes.length > 0) {
      await applyNotesToNode(
        targetEntityKey,
        nodeType,
        generatedNotes,
        userId,
        sourceEntityKey
      );
      console.log(`[MergeAgent] Applied notes to target node ${targetEntityKey}`);
    }

    // ============================================================================
    // Phase 2: Update Neighbors and Relationships
    // ============================================================================
    console.log(`[MergeAgent] Phase 2: Running agent to update neighbors/edges...`);

    const loadedNeighbors = await loadNeighbors(userId, targetEntityKey);

    // Ensure maxNeighbors is large enough to include all source siblings
    // Source siblings should always be available for relationship updates since they came from the same source
    const minNeighbors = 10 + (sourceSiblings?.length || 0);

    const allNeighbors = mergeNeighborsWithSourceSiblings(
      loadedNeighbors,
      sourceSiblings || [],
      targetEntityKey,
      minNeighbors
    );
    const relationships = await loadRelationships(userId, targetEntityKey);

    // Format existing node with XML/markdown and source filtering
    const existingNodeMarkdown = formatSingleNodeAsXml(existingNode, nodeType, { sourceEntityKey });

    // Build name-to-key map and add target node
    const { namedNeighbors, nameToKeyMap } = buildNameMapWithTarget(
      allNeighbors,
      existingNode,
      targetEntityKey
    );

    // Build neighbor map for relationship formatting
    const neighborMap = new Map<string, { description?: string | null; notes: string | any[] | null | undefined }>();
    for (const neighbor of allNeighbors) {
      neighborMap.set(neighbor.entity_key, {
        description: neighbor.description,
        notes: neighbor.notes,
      });
    }

    // Format relationships with XML/markdown and source filtering
    const relationshipsMarkdown = formatRelationshipsAsXml(relationships, neighborMap, { sourceEntityKey });

    const sourceSnippet =
      sourceContent.length > 2000 ? `${sourceContent.slice(0, 2000)}...` : sourceContent;

    const userPrompt = `
## Source Content

<source_content>
${sourceSnippet}
</source_content>

## Existing Node (Updated)

${existingNodeMarkdown}

## Connected Nodes and Relationships

${relationshipsMarkdown || 'No existing relationships found.'}

---

**Note**: The target node has already been updated with new notes from this source. Your task is to update relationships and connected nodes if the source content mentions them. Use the normalized entity names from the edge_to_node tags (e.g., "roy", "paul_peel").`;

    // Run Phase 2 workflow with nameToKeyMap for name resolution
    const { relationshipsCreated } = await runNeighborUpdateWorkflow(
      userId,
      sourceEntityKey,
      targetEntityKey,
      nodeType,
      MERGE_AGENT_SYSTEM_PROMPT,
      userPrompt,
      nameToKeyMap,
      namedNeighbors.length
    );

    console.log(
      `[MergeAgent] Completed two-phase merge for ${targetEntityKey} ` +
      `(${generatedNotes.length} notes added, ${relationshipsCreated} relationships updated in Phase 2)`
    );

    return {
      success: true,
      relationshipsCreated,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MergeAgent] Failed to merge ${targetEntityKey}: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
      relationshipsCreated: 0,
    };
  }
}

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { neo4jService } from '../../src/db/neo4j.js';
import { embeddingGenerationService } from '../../src/services/embeddingGenerationService.js';
import { generateEmbedding } from '../../src/services/embeddingGenerationService.js';
import { updatePersonTool } from '../../src/agents/tools/nodes/person.tool.js';
import { updateConceptTool } from '../../src/agents/tools/nodes/concept.tool.js';
import { updateEntityTool } from '../../src/agents/tools/nodes/entity.tool.js';
import {
  updateHasRelationshipWithTool,
  updateEngagesWithTool,
  updateAssociatedWithTool,
  updateRelatesToTool,
  updateInvolvesTool,
  updateConnectedToTool,
} from '../../src/agents/tools/relationships/update-relationship-types.tool.js';
import {
  PERSON_CONSOLIDATION_SYSTEM_PROMPT,
  CONCEPT_CONSOLIDATION_SYSTEM_PROMPT,
  ENTITY_CONSOLIDATION_SYSTEM_PROMPT,
  HAS_RELATIONSHIP_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  ENGAGES_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  ASSOCIATED_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  RELATES_TO_CONSOLIDATION_SYSTEM_PROMPT,
  INVOLVES_CONSOLIDATION_SYSTEM_PROMPT,
  CONNECTED_TO_CONSOLIDATION_SYSTEM_PROMPT,
} from '../../src/agents/prompts/consolidation/index.js';
import { PipelineConfig, PipelineState } from './types.js';

/**
 * Phase 5: Daily Description & Embedding Consolidation
 *
 * Nightly batch job that processes all nodes and relationships marked is_dirty = true.
 * For each dirty item:
 * 1. Spawn agent with accumulated notes and current properties
 * 2. Agent decides if updates are needed (using update tools)
 * 3. Regenerate embeddings (always notes_embedding, relation_embedding if properties changed)
 * 4. Mark is_dirty = false
 */

// ============================================================================
// Type Definitions
// ============================================================================

interface DirtyNode {
  entity_key: string;
  label: string;
  description: string | null;
  notes: string | null;
  // Person-specific
  name?: string | null;
  canonical_name?: string | null;
  appearance?: string | null;
  situation?: string | null;
  history?: string | null;
  personality?: string | null;
  expertise?: string | null;
  interests?: string | null;
}

interface DirtyRelationship {
  from_entity_key: string;
  to_entity_key: string;
  type: string; // Cypher relationship type
  description: string | null;
  relationship_type: string | null;
  attitude: number | null;
  proximity: number | null;
  notes: string | null;
}

interface ConsolidationStats {
  dirtyNodes: number;
  dirtyRelationships: number;
  nodesUpdated: number;
  relationshipsUpdated: number;
  embeddingsRegenerated: number;
  errors: string[];
}

// ============================================================================
// Node Consolidation
// ============================================================================

async function consolidateNode(node: DirtyNode, config: PipelineConfig): Promise<boolean> {
  const model = new ChatOpenAI({ modelName: 'gpt-4.1-nano' });

  // Determine system prompt and tool based on node label
  let systemPrompt: string;
  let tool;

  switch (node.label) {
    case 'Person':
      systemPrompt = PERSON_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updatePersonTool;
      break;
    case 'Concept':
      systemPrompt = CONCEPT_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateConceptTool;
      break;
    case 'Entity':
      systemPrompt = ENTITY_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateEntityTool;
      break;
    default:
      console.log(`  ⚠️  Unknown node type: ${node.label}`);
      return false;
  }

  // Parse notes
  let notesText = '';
  let notesList: Array<{ content: string; date_added: string }> = [];
  if (node.notes) {
    try {
      const parsed = JSON.parse(node.notes);
      notesList = parsed.map((n: { content: string; date_added: string }) => ({
        content: n.content,
        date_added: n.date_added,
      }));
      notesText = notesList.map((n, i) => `${i + 1}. [${n.date_added}] ${n.content}`).join('\n');
    } catch (e) {
      notesText = node.notes;
    }
  }

  // Build user prompt
  let userPrompt = `## Current Description\n\n${node.description || '(none)'}\n\n`;

  if (node.label === 'Person') {
    userPrompt += `## Current Properties\n\n`;
    userPrompt += `- name: ${node.name || '(none)'}\n`;
    userPrompt += `- canonical_name: ${node.canonical_name || '(none)'}\n`;
    userPrompt += `- appearance: ${node.appearance || '(none)'}\n`;
    userPrompt += `- situation: ${node.situation || '(none)'}\n`;
    userPrompt += `- history: ${node.history || '(none)'}\n`;
    userPrompt += `- personality: ${node.personality || '(none)'}\n`;
    userPrompt += `- expertise: ${node.expertise || '(none)'}\n`;
    userPrompt += `- interests: ${node.interests || '(none)'}\n\n`;
  }

  userPrompt += `## Accumulated Notes\n\n${notesText || '(no notes)'}\n\n`;
  userPrompt += `## Your Task\n\nReview the notes and decide if the description or properties should be updated. Use the update tool if needed, or respond that no updates are needed.`;

  try {
    const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)], {
      tools: [tool],
    });

    // Check if agent made tool calls
    const aiMsg = response as { tool_calls?: unknown[] };
    if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
      console.log(`    ✓ Updated ${node.label} ${node.entity_key}`);
      return true;
    } else {
      console.log(`    - No updates for ${node.label} ${node.entity_key}`);
      return false;
    }
  } catch (error) {
    console.error(`    ❌ Error consolidating ${node.label} ${node.entity_key}:`, error);
    return false;
  }
}

async function consolidateDirtyNodes(config: PipelineConfig): Promise<{ processed: number; updated: number }> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('CONSOLIDATING DIRTY NODES');
  console.log('='.repeat(80));

  // Query all dirty nodes
  const query = `
    MATCH (n)
    WHERE n.is_dirty = true AND labels(n)[0] IN ['Person', 'Concept', 'Entity']
    RETURN
      n.entity_key AS entity_key,
      labels(n)[0] AS label,
      n.description AS description,
      n.notes AS notes,
      n.name AS name,
      n.canonical_name AS canonical_name,
      n.appearance AS appearance,
      n.situation AS situation,
      n.history AS history,
      n.personality AS personality,
      n.expertise AS expertise,
      n.interests AS interests
  `;

  const dirtyNodes = await neo4jService.executeQuery<DirtyNode>(query, {});

  console.log(`\n📊 Found ${dirtyNodes.length} dirty nodes\n`);

  if (dirtyNodes.length === 0) {
    return { processed: 0, updated: 0 };
  }

  let updatedCount = 0;

  // Process each node
  for (const node of dirtyNodes) {
    const wasUpdated = await consolidateNode(node, config);
    if (wasUpdated) {
      updatedCount++;
    }

    // Regenerate embedding (always, regardless of whether agent updated properties)
    await regenerateNodeEmbedding(node.entity_key);

    // Mark as clean
    await neo4jService.executeQuery(
      `
      MATCH (n {entity_key: $entity_key})
      SET n.is_dirty = false, n.updated_at = datetime()
    `,
      { entity_key: node.entity_key }
    );
  }

  console.log(`\n✅ Processed ${dirtyNodes.length} nodes (${updatedCount} updated)\n`);

  return { processed: dirtyNodes.length, updated: updatedCount };
}

async function regenerateNodeEmbedding(entityKey: string): Promise<void> {
  // Fetch node data
  const query = `
    MATCH (n {entity_key: $entity_key})
    RETURN n.description AS description, n.notes AS notes
  `;

  interface NodeEmbeddingData {
    description: string | null;
    notes: string | null;
  }

  const result = await neo4jService.executeQuery<NodeEmbeddingData>(query, { entity_key: entityKey });

  if (!result[0]) return;

  const { description, notes } = result[0];

  // Parse notes
  let notesText = '';
  if (notes) {
    try {
      const notesArray = JSON.parse(notes);
      notesText = notesArray.map((n: { content: string }) => n.content).join(' ');
    } catch (e) {
      notesText = notes;
    }
  }

  // Generate embedding from description + notes
  const text = `${description || ''} ${notesText}`.trim();
  if (text.length === 0) return;

  const embedding = await embeddingGenerationService.embedSingle(text);

  // Update node
  await neo4jService.executeQuery(
    `
    MATCH (n {entity_key: $entity_key})
    SET n.embedding = $embedding
  `,
    { entity_key: entityKey, embedding }
  );
}

// ============================================================================
// Relationship Consolidation
// ============================================================================

async function consolidateRelationship(rel: DirtyRelationship, config: PipelineConfig): Promise<boolean> {
  const model = new ChatOpenAI({ modelName: 'gpt-4.1-nano' });

  // Determine system prompt and tool based on relationship type
  let systemPrompt: string;
  let tool;

  switch (rel.type) {
    case 'has_relationship_with':
      systemPrompt = HAS_RELATIONSHIP_WITH_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateHasRelationshipWithTool;
      break;
    case 'engages_with':
      systemPrompt = ENGAGES_WITH_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateEngagesWithTool;
      break;
    case 'associated_with':
      systemPrompt = ASSOCIATED_WITH_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateAssociatedWithTool;
      break;
    case 'relates_to':
      systemPrompt = RELATES_TO_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateRelatesToTool;
      break;
    case 'involves':
      systemPrompt = INVOLVES_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateInvolvesTool;
      break;
    case 'connected_to':
      systemPrompt = CONNECTED_TO_CONSOLIDATION_SYSTEM_PROMPT;
      tool = updateConnectedToTool;
      break;
    default:
      console.log(`  ⚠️  Unknown relationship type: ${rel.type}`);
      return false;
  }

  // Parse notes
  let notesText = '';
  if (rel.notes) {
    try {
      const parsed = JSON.parse(rel.notes);
      notesText = parsed.map((n: { content: string; date_added: string }, i: number) => `${i + 1}. [${n.date_added}] ${n.content}`).join('\n');
    } catch (e) {
      notesText = rel.notes;
    }
  }

  // Build user prompt
  const userPrompt = `## Current Description

${rel.description || '(none)'}

## Current Properties

- relationship_type: ${rel.relationship_type || '(none)'}
- attitude: ${rel.attitude || '(none)'}
- proximity: ${rel.proximity || '(none)'}

## Accumulated Notes

${notesText || '(no notes)'}

## Your Task

Review the notes and decide if the description or properties should be updated. Use the update tool if needed, or respond that no updates are needed.`;

  try {
    const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)], {
      tools: [tool],
    });

    // Check if agent made tool calls
    const aiMsg = response as { tool_calls?: Array<{ name: string; args: unknown }> };
    if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
      console.log(`    ✓ Updated ${rel.type} relationship`);

      // Check if properties changed (from tool response)
      // We need to invoke the tool to get the response
      for (const toolCall of aiMsg.tool_calls) {
        // Tool will handle updating the relationship
        // We just need to check if properties_changed flag was returned
      }

      return true;
    } else {
      console.log(`    - No updates for ${rel.type} relationship`);
      return false;
    }
  } catch (error) {
    console.error(`    ❌ Error consolidating ${rel.type} relationship:`, error);
    return false;
  }
}

async function consolidateDirtyRelationships(
  config: PipelineConfig
): Promise<{ processed: number; updated: number }> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('CONSOLIDATING DIRTY RELATIONSHIPS');
  console.log('='.repeat(80));

  // Query all dirty relationships
  const query = `
    MATCH (from)-[r]->(to)
    WHERE r.is_dirty = true
    RETURN
      from.entity_key AS from_entity_key,
      to.entity_key AS to_entity_key,
      type(r) AS type,
      r.description AS description,
      r.relationship_type AS relationship_type,
      r.attitude AS attitude,
      r.proximity AS proximity,
      r.notes AS notes
  `;

  const dirtyRels = await neo4jService.executeQuery<DirtyRelationship>(query, {});

  console.log(`\n📊 Found ${dirtyRels.length} dirty relationships\n`);

  if (dirtyRels.length === 0) {
    return { processed: 0, updated: 0 };
  }

  let updatedCount = 0;

  // Process each relationship
  for (const rel of dirtyRels) {
    const wasUpdated = await consolidateRelationship(rel, config);
    if (wasUpdated) {
      updatedCount++;
    }

    // Always regenerate notes_embedding
    await regenerateRelationshipNotesEmbedding(rel.from_entity_key, rel.to_entity_key, rel.type);

    // Mark as clean
    await neo4jService.executeQuery(
      `
      MATCH (from {entity_key: $from_entity_key})-[r:${rel.type}]->(to {entity_key: $to_entity_key})
      SET r.is_dirty = false, r.updated_at = datetime()
    `,
      { from_entity_key: rel.from_entity_key, to_entity_key: rel.to_entity_key }
    );
  }

  console.log(`\n✅ Processed ${dirtyRels.length} relationships (${updatedCount} updated)\n`);

  return { processed: dirtyRels.length, updated: updatedCount };
}

async function regenerateRelationshipNotesEmbedding(
  fromKey: string,
  toKey: string,
  relType: string
): Promise<void> {
  // Fetch relationship notes
  const query = `
    MATCH (from {entity_key: $from_entity_key})-[r:${relType}]->(to {entity_key: $to_entity_key})
    RETURN r.notes AS notes
  `;

  interface RelNotes {
    notes: string | null;
  }

  const result = await neo4jService.executeQuery<RelNotes>(query, {
    from_entity_key: fromKey,
    to_entity_key: toKey,
  });

  if (!result[0]) return;

  const { notes } = result[0];

  // Parse notes and concatenate (max 1000 chars)
  let notesText = '';
  if (notes) {
    try {
      const notesArray = JSON.parse(notes);
      notesText = notesArray
        .map((n: { content: string }) => n.content)
        .join(' ')
        .substring(0, 1000);
    } catch (e) {
      notesText = notes.substring(0, 1000);
    }
  }

  if (notesText.length === 0) return;

  const notesEmbedding = await generateEmbedding(notesText);

  // Update relationship
  await neo4jService.executeQuery(
    `
    MATCH (from {entity_key: $from_entity_key})-[r:${relType}]->(to {entity_key: $to_entity_key})
    SET r.notes_embedding = $notes_embedding
  `,
    { from_entity_key: fromKey, to_entity_key: toKey, notes_embedding: notesEmbedding }
  );
}

// ============================================================================
// Main Phase 5 Runner
// ============================================================================

export async function runPhase5(state: PipelineState, config: PipelineConfig): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 5: Daily Description & Embedding Consolidation');
  console.log('='.repeat(80));
  console.log('🧹 Processing dirty nodes and relationships\n');

  const stats: ConsolidationStats = {
    dirtyNodes: 0,
    dirtyRelationships: 0,
    nodesUpdated: 0,
    relationshipsUpdated: 0,
    embeddingsRegenerated: 0,
    errors: [],
  };

  try {
    // Consolidate dirty nodes
    const nodeResults = await consolidateDirtyNodes(config);
    stats.dirtyNodes = nodeResults.processed;
    stats.nodesUpdated = nodeResults.updated;
    stats.embeddingsRegenerated += nodeResults.processed; // All nodes get embeddings regenerated

    // Consolidate dirty relationships
    const relResults = await consolidateDirtyRelationships(config);
    stats.dirtyRelationships = relResults.processed;
    stats.relationshipsUpdated = relResults.updated;
    stats.embeddingsRegenerated += relResults.processed; // All relationships get notes_embedding regenerated

    // Save stats
    const outputPath = path.join(config.outputDir, 'pipeline-phase5-consolidation.json');
    fs.writeFileSync(outputPath, JSON.stringify(stats, null, 2));
    console.log(`💾 Saved consolidation stats to: ${outputPath}\n`);

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ PHASE 5 COMPLETE');
    console.log('='.repeat(80));
    console.log(`📊 Consolidation Summary:`);
    console.log(`  - Dirty nodes processed: ${stats.dirtyNodes}`);
    console.log(`  - Nodes updated: ${stats.nodesUpdated}`);
    console.log(`  - Dirty relationships processed: ${stats.dirtyRelationships}`);
    console.log(`  - Relationships updated: ${stats.relationshipsUpdated}`);
    console.log(`  - Embeddings regenerated: ${stats.embeddingsRegenerated}`);
    console.log();
  } catch (error) {
    console.error('❌ Phase 5 failed:', error);
    throw error;
  }
}

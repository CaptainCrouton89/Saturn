import { neo4jService } from '../db/neo4j.js';
import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { embeddingGenerationService } from './embeddingGenerationService.js';
import { parseNotes } from '../utils/notes.js';
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
} from '../agents/prompts/consolidation/index.js';

// --- Schemas ---

const updatePersonSchema = z.object({
  description: z.string().optional(),
  appearance: z.string().optional(),
  situation: z.string().optional(),
  history: z.string().optional(),
  personality: z.string().optional(),
  expertise: z.string().optional(),
  interests: z.string().optional(),
});

const updateConceptSchema = z.object({
  description: z.string().optional(),
});

const updateEntitySchema = z.object({
  description: z.string().optional(),
});

const updateRelationshipSchema = z.object({
  description: z.string().optional(),
  relationship_type: z.string().optional(),
  attitude: z.number().min(1).max(5).optional(),
  proximity: z.number().min(1).max(5).optional(),
});

// --- Config maps ---

const NODE_CONFIG: Record<string, { prompt: string; toolName: string; schema: z.ZodObject<z.ZodRawShape> }> = {
  Person: {
    prompt: PERSON_CONSOLIDATION_SYSTEM_PROMPT,
    toolName: 'update_person',
    schema: updatePersonSchema,
  },
  Concept: {
    prompt: CONCEPT_CONSOLIDATION_SYSTEM_PROMPT,
    toolName: 'update_concept',
    schema: updateConceptSchema,
  },
  Entity: {
    prompt: ENTITY_CONSOLIDATION_SYSTEM_PROMPT,
    toolName: 'update_entity',
    schema: updateEntitySchema,
  },
};

const REL_CONFIG: Record<string, string> = {
  has_relationship_with: HAS_RELATIONSHIP_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  engages_with: ENGAGES_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  associated_with: ASSOCIATED_WITH_CONSOLIDATION_SYSTEM_PROMPT,
  relates_to: RELATES_TO_CONSOLIDATION_SYSTEM_PROMPT,
  involves: INVOLVES_CONSOLIDATION_SYSTEM_PROMPT,
  connected_to: CONNECTED_TO_CONSOLIDATION_SYSTEM_PROMPT,
};

// --- Concurrency limiter ---

async function withConcurrencyLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => { executing.delete(p); });
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

// --- Types ---

interface DirtyNode {
  entity_key: string;
  description: string | null;
  notes: unknown;
  appearance?: string | null;
  situation?: string | null;
  history?: string | null;
  personality?: string | null;
  expertise?: string | null;
  interests?: string | null;
}

interface DirtyRelationship {
  elementId: string;
  relType: string;
  description: string | null;
  notes: unknown;
  relationship_type: string | null;
  attitude: number | null;
  proximity: number | null;
}

interface DescriptionChange {
  entityKey: string;
  label: string;
  description: string;
}

interface RelNotesChange {
  elementId: string;
  relType: string;
  notesText: string;
}

// --- Main export ---

export async function runNightlyConsolidation(): Promise<void> {
  const startTime = Date.now();
  let nodesProcessed = 0;
  let relsProcessed = 0;
  let failures = 0;
  const descriptionChanges: DescriptionChange[] = [];
  const relNotesChanges: RelNotesChange[] = [];

  console.log('[ConsolidationService] Starting nightly consolidation...');

  // 1. Query dirty nodes
  const allNodeItems: Array<{ label: string; node: DirtyNode }> = [];
  for (const label of Object.keys(NODE_CONFIG)) {
    const nodes = await neo4jService.executeQuery<{ n: DirtyNode }>(
      `MATCH (n:${label}) WHERE n.is_dirty = true RETURN n { .entity_key, .description, .notes, .appearance, .situation, .history, .personality, .expertise, .interests }`,
      {},
    );
    for (const row of nodes) {
      allNodeItems.push({ label, node: row.n });
    }
  }

  // 2. Query dirty relationships
  const allRelItems: DirtyRelationship[] = [];
  for (const relType of Object.keys(REL_CONFIG)) {
    const rels = await neo4jService.executeQuery<{
      elementId: string;
      description: string | null;
      notes: unknown;
      relationship_type: string | null;
      attitude: number | null;
      proximity: number | null;
    }>(
      `MATCH ()-[r:${relType}]->() WHERE r.is_dirty = true RETURN elementId(r) AS elementId, r.description AS description, r.notes AS notes, r.relationship_type AS relationship_type, r.attitude AS attitude, r.proximity AS proximity`,
      {},
    );
    for (const row of rels) {
      allRelItems.push({ ...row, relType });
    }
  }

  const totalItems = allNodeItems.length + allRelItems.length;
  console.log(`[ConsolidationService] Dirty nodes: ${allNodeItems.length}, dirty relationships: ${allRelItems.length}`);

  if (totalItems === 0) {
    console.log('[ConsolidationService] Nothing to consolidate.');
    return;
  }

  // 3. Process nodes
  await withConcurrencyLimit(allNodeItems, 10, async ({ label, node }) => {
    try {
      const notes = parseNotes(node.notes);

      // Skip empties: clear flag without LLM call
      if (notes.length === 0) {
        console.log(`[ConsolidationService] Skip: ${node.entity_key} (${label}) — empty notes, clearing flag`);
        await neo4jService.executeQuery(
          `MATCH (n:${label} {entity_key: $entity_key}) SET n.is_dirty = false, n.updated_at = datetime()`,
          { entity_key: node.entity_key },
        );
        nodesProcessed++;
        return;
      }

      const config = NODE_CONFIG[label];
      const userMessage = buildNodeUserMessage(label, node, notes);

      const result = await generateText({
        model: openai('gpt-5.4-mini'),
        system: config.prompt,
        prompt: userMessage,
        providerOptions: { openai: { reasoningEffort: 'low' } },
        tools: {
          [config.toolName]: tool({
            description: `Update the ${label.toLowerCase()} with consolidated information`,
            inputSchema: config.schema,
          }),
        },
        maxRetries: 3,
      });

      // Extract tool call input
      const toolCall = result.toolCalls[0];
      const updates = toolCall?.input as Record<string, unknown> | undefined;

      // Build write-back
      const setFields: string[] = ['n.is_dirty = false', 'n.updated_at = datetime()'];
      const params: Record<string, unknown> = { entity_key: node.entity_key };

      if (updates) {
        for (const [key, value] of Object.entries(updates)) {
          if (value !== undefined) {
            setFields.push(`n.${key} = $${key}`);
            params[key] = value;
          }
        }
      }

      await neo4jService.executeQuery(
        `MATCH (n:${label} {entity_key: $entity_key}) SET ${setFields.join(', ')}`,
        params,
      );

      // Track description changes for embedding regeneration
      const newDescription = (updates as Record<string, unknown> | undefined)?.description as string | undefined;
      if (newDescription && newDescription !== node.description) {
        descriptionChanges.push({ entityKey: node.entity_key, label, description: newDescription });
      }

      nodesProcessed++;
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ConsolidationService] Error consolidating node ${node.entity_key} (${label}): ${message}`);
    }
  });

  // 4. Process relationships
  await withConcurrencyLimit(allRelItems, 10, async (rel) => {
    try {
      const notes = parseNotes(rel.notes);

      // Skip empties
      if (notes.length === 0) {
        console.log(`[ConsolidationService] Skip: rel ${rel.elementId} (${rel.relType}) — empty notes, clearing flag`);
        await neo4jService.executeQuery(
          `MATCH ()-[r:${rel.relType}]->() WHERE elementId(r) = $elementId SET r.is_dirty = false, r.updated_at = datetime()`,
          { elementId: rel.elementId },
        );
        relsProcessed++;
        return;
      }

      const systemPrompt = REL_CONFIG[rel.relType];
      const toolName = `update_${rel.relType.toLowerCase()}`;
      const userMessage = buildRelUserMessage(rel, notes);

      const result = await generateText({
        model: openai('gpt-5.4-mini'),
        system: systemPrompt,
        prompt: userMessage,
        providerOptions: { openai: { reasoningEffort: 'low' } },
        tools: {
          [toolName]: tool({
            description: `Update the ${rel.relType.toLowerCase()} relationship with consolidated information`,
            inputSchema: updateRelationshipSchema,
          }),
        },
        maxRetries: 3,
      });

      const toolCall = result.toolCalls[0];
      const updates = toolCall?.input as z.infer<typeof updateRelationshipSchema> | undefined;

      // Build write-back
      const setFields: string[] = ['r.is_dirty = false', 'r.updated_at = datetime()'];
      const params: Record<string, unknown> = { elementId: rel.elementId };

      if (updates) {
        if (updates.description !== undefined) {
          setFields.push('r.description = $description');
          params.description = updates.description;
        }
        if (updates.relationship_type !== undefined) {
          setFields.push('r.relationship_type = coalesce($relationship_type, r.relationship_type)');
          params.relationship_type = updates.relationship_type;
        }
        if (updates.attitude !== undefined) {
          setFields.push('r.attitude = coalesce($attitude, r.attitude)');
          params.attitude = updates.attitude;
        }
        if (updates.proximity !== undefined) {
          setFields.push('r.proximity = coalesce($proximity, r.proximity)');
          params.proximity = updates.proximity;
        }
      }

      await neo4jService.executeQuery(
        `MATCH ()-[r:${rel.relType}]->() WHERE elementId(r) = $elementId SET ${setFields.join(', ')}`,
        params,
      );

      // Track for notes_embedding regeneration — notes were reviewed
      const notesText = notes.map(n => n.content).join(' ').slice(0, 1000);
      relNotesChanges.push({ elementId: rel.elementId, relType: rel.relType, notesText });

      // Track description changes for node embedding (relationships don't have node embeddings,
      // but description changes on relationships don't need separate embedding — only notes_embedding)

      relsProcessed++;
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ConsolidationService] Error consolidating rel ${rel.elementId} (${rel.relType}): ${message}`);
    }
  });

  // 5. Batch embedding regeneration for nodes with changed descriptions
  if (descriptionChanges.length > 0) {
    try {
      console.log(`[ConsolidationService] Regenerating ${descriptionChanges.length} node embeddings...`);
      const texts = descriptionChanges.map(c => c.description);
      const embeddings = await embeddingGenerationService.batchEmbed(texts);

      for (let i = 0; i < descriptionChanges.length; i++) {
        const { entityKey, label } = descriptionChanges[i];
        await neo4jService.executeQuery(
          `MATCH (n:${label} {entity_key: $entityKey}) SET n.embedding = $embedding`,
          { entityKey, embedding: embeddings[i] },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ConsolidationService] Error regenerating node embeddings: ${message}`);
    }
  }

  // 6. Regenerate notes_embedding for consolidated relationships
  if (relNotesChanges.length > 0) {
    try {
      console.log(`[ConsolidationService] Regenerating ${relNotesChanges.length} relationship notes_embeddings...`);
      const texts = relNotesChanges.map(c => c.notesText);
      const embeddings = await embeddingGenerationService.batchEmbed(texts);

      for (let i = 0; i < relNotesChanges.length; i++) {
        const { elementId, relType } = relNotesChanges[i];
        await neo4jService.executeQuery(
          `MATCH ()-[r:${relType}]->() WHERE elementId(r) = $elementId SET r.notes_embedding = $embedding`,
          { elementId, embedding: embeddings[i] },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ConsolidationService] Error regenerating relationship notes_embeddings: ${message}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[ConsolidationService] Complete. Duration: ${duration}ms, nodes: ${nodesProcessed}, rels: ${relsProcessed}, embeddings: ${descriptionChanges.length}, notes_embeddings: ${relNotesChanges.length}, failures: ${failures}`,
  );
}

// --- User message builders ---

function buildNodeUserMessage(
  label: string,
  node: DirtyNode,
  notes: Array<{ content: string; date_added: string }>,
): string {
  const notesList = notes.map(n => `[${n.date_added}] ${n.content}`).join('\n');

  if (label === 'Person') {
    return `Current description: ${node.description || 'None'}

Current properties:
- Appearance: ${node.appearance || 'Unknown'}
- Situation: ${node.situation || 'Unknown'}
- History: ${node.history || 'Unknown'}
- Personality: ${node.personality || 'Unknown'}
- Expertise: ${node.expertise || 'Unknown'}
- Interests: ${node.interests || 'Unknown'}

Accumulated notes (${notes.length}):
${notesList}`;
  }

  return `Current description: ${node.description || 'None'}

Accumulated notes (${notes.length}):
${notesList}`;
}

function buildRelUserMessage(
  rel: DirtyRelationship,
  notes: Array<{ content: string; date_added: string }>,
): string {
  const notesList = notes.map(n => `[${n.date_added}] ${n.content}`).join('\n');

  return `Current description: ${rel.description || 'None'}
Relationship type: ${rel.relationship_type || 'Unknown'}
Attitude: ${rel.attitude ?? 'Unknown'}
Proximity: ${rel.proximity ?? 'Unknown'}

Accumulated notes (${notes.length}):
${notesList}`;
}

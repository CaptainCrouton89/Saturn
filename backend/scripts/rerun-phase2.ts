/**
 * Re-run Phase 2 (relationship creation) for orphaned nodes from a specific source.
 *
 * Usage:
 *   npx dotenv-cli -e .env.production -- tsx scripts/rerun-phase2.ts <source_entity_key>
 */

import 'dotenv/config';
import { neo4jService } from '../src/db/neo4j.js';
import { runCreateAgentPhase2Only } from '../src/agents/createAgent.js';
import type { ExtractedEntity } from '../src/types/ingestion.js';
import type { SourceSibling } from '../src/utils/neighborHelpers.js';

const SOURCE_KEY = process.argv[2];
if (!SOURCE_KEY) {
  console.error('Usage: tsx scripts/rerun-phase2.ts <source_entity_key>');
  process.exit(1);
}

const CONCURRENCY = 3;

async function main() {
  await neo4jService.connect();

  // Load source content
  const [sourceNode] = await neo4jService.executeQuery<{ content: string; user_id: string }>(
    `MATCH (s:Source {entity_key: $key}) RETURN s.content AS content, s.user_id AS user_id`,
    { key: SOURCE_KEY }
  );
  if (!sourceNode) {
    console.error(`Source ${SOURCE_KEY} not found`);
    process.exit(1);
  }

  const { content: sourceContent, user_id: userId } = sourceNode;
  console.log(`Source found for user ${userId}, content length: ${sourceContent.length}`);

  // Find orphaned nodes (only have mentions edges, no semantic relationships)
  const orphans = await neo4jService.executeQuery<{
    entity_key: string;
    name: string;
    type: string;
    embedding: number[];
  }>(
    `MATCH (n)-[:mentions]-(s:Source {entity_key: $key})
     WHERE NOT n:Source
     WITH n, size([(n)-[r]-() WHERE NOT type(r) = 'mentions' | r]) AS semantic_rels
     WHERE semantic_rels = 0
     RETURN n.entity_key AS entity_key, n.name AS name, toLower(labels(n)[0]) AS type, n.embedding AS embedding`,
    { key: SOURCE_KEY }
  );

  console.log(`Found ${orphans.length} orphaned nodes to process`);

  if (orphans.length === 0) {
    console.log('Nothing to do');
    await neo4jService.close();
    return;
  }

  // Build source siblings list from ALL entities mentioned by this source
  const allSiblings = await neo4jService.executeQuery<{
    entity_key: string;
    name: string;
    type: string;
  }>(
    `MATCH (n)-[:mentions]-(s:Source {entity_key: $key})
     WHERE NOT n:Source
     RETURN n.entity_key AS entity_key, n.name AS name, toLower(labels(n)[0]) AS type`,
    { key: SOURCE_KEY }
  );

  const sourceSiblings: SourceSibling[] = allSiblings.map(s => ({
    entity_key: s.entity_key,
    name: s.name,
    entity_type: s.type as SourceSibling['entity_type'],
  }));

  console.log(`Built ${sourceSiblings.length} source siblings for context`);

  // Process in batches
  let totalRels = 0;
  let processed = 0;

  for (let i = 0; i < orphans.length; i += CONCURRENCY) {
    const batch = orphans.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (orphan) => {
        const extractedEntity: ExtractedEntity = {
          name: orphan.name,
          entity_type: orphan.type as ExtractedEntity['entity_type'],
          confidence: 0.8,
          embedding: orphan.embedding,
        };

        const relsCreated = await runCreateAgentPhase2Only(
          orphan.entity_key,
          extractedEntity,
          sourceContent,
          userId,
          SOURCE_KEY,
          sourceSiblings,
        );

        return { name: orphan.name, relsCreated };
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled') {
        totalRels += result.value.relsCreated;
        console.log(`[${processed}/${orphans.length}] ${result.value.name}: ${result.value.relsCreated} relationships`);
      } else {
        console.error(`[${processed}/${orphans.length}] FAILED:`, result.reason?.message || result.reason);
      }
    }
  }

  console.log(`\nDone: ${totalRels} relationships created across ${orphans.length} nodes`);
  await neo4jService.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

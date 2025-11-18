/**
 * Cleanup LoCoMo Evaluation Data
 *
 * Deletes all Neo4j nodes and relationships for LoCoMo evaluation user(s).
 * Supports:
 * - Deletion by user_id (removes all data for specific user)
 * - Deletion by provenance.origin (removes all LoCoMo eval sources across users)
 * - Full cleanup (both methods combined)
 *
 * Usage:
 *   pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id locomo-eval-user
 *   pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --provenance-origin locomo-eval
 *   pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --all
 */

import 'dotenv/config';
import { neo4jService } from '../../src/db/neo4j.js';

// ============================================================================
// Configuration
// ============================================================================

interface CleanupConfig {
  userId?: string;
  provenanceOrigin?: string;
  deleteAll?: boolean;
}

// ============================================================================
// Deletion Queries
// ============================================================================

/**
 * Delete all nodes and relationships for a specific user_id
 * Follows dependency order: hierarchical → episodic → semantic relationships → semantic nodes
 */
async function deleteByUserId(userId: string): Promise<void> {
  console.log(`\n🗑️  Deleting all data for user_id: ${userId}\n`);

  try {
    // 1. Delete Macros (hierarchical aggregations)
    console.log('   Deleting Macros...');
    const macroResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (m:Macro {user_id: $user_id}) WITH m, count(m) as count DETACH DELETE m RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${macroResult[0]?.count ?? 0} Macros`);

    // 2. Delete Storylines (hierarchical aggregations)
    console.log('   Deleting Storylines...');
    const storylineResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (st:Storyline {user_id: $user_id}) WITH st, count(st) as count DETACH DELETE st RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${storylineResult[0]?.count ?? 0} Storylines`);

    // 3. Delete Artifacts (episodic)
    console.log('   Deleting Artifacts...');
    const artifactResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (a:Artifact {user_id: $user_id}) WITH a, count(a) as count DETACH DELETE a RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${artifactResult[0]?.count ?? 0} Artifacts`);

    // 4. Delete Sources (episodic) - only personal sources (team_id IS NULL)
    console.log('   Deleting Sources (personal only)...');
    const sourceResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (s:Source {user_id: $user_id}) WHERE s.team_id IS NULL WITH s, count(s) as count DETACH DELETE s RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${sourceResult[0]?.count ?? 0} Sources`);

    // 5. Delete semantic relationships (by user_id property)
    console.log('   Deleting semantic relationships...');
    const relResult = await neo4jService.executeQuery<{ count: number }>(
      `MATCH ()-[r:has_relationship_with|engages_with|associated_with|relates_to|involves|connected_to {user_id: $user_id}]-()
       WITH r, count(r) as count DELETE r RETURN count`,
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${relResult[0]?.count ?? 0} semantic relationships`);

    // 6. Delete Person nodes (semantic)
    console.log('   Deleting Person nodes...');
    const personResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (p:Person {user_id: $user_id}) WITH p, count(p) as count DETACH DELETE p RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${personResult[0]?.count ?? 0} Person nodes`);

    // 7. Delete Concept nodes (semantic)
    console.log('   Deleting Concept nodes...');
    const conceptResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (c:Concept {user_id: $user_id}) WITH c, count(c) as count DETACH DELETE c RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${conceptResult[0]?.count ?? 0} Concept nodes`);

    // 8. Delete Entity nodes (semantic)
    console.log('   Deleting Entity nodes...');
    const entityResult = await neo4jService.executeQuery<{ count: number }>(
      'MATCH (e:Entity {user_id: $user_id}) WITH e, count(e) as count DETACH DELETE e RETURN count',
      { user_id: userId }
    );
    console.log(`   ✅ Deleted ${entityResult[0]?.count ?? 0} Entity nodes`);

    console.log(`\n✅ Cleanup complete for user_id: ${userId}`);
  } catch (error) {
    console.error(`\n❌ Cleanup failed for user_id ${userId}:`, error);
    throw error;
  }
}

/**
 * Delete all Sources with specific provenance.origin value
 * This removes LoCoMo evaluation sources regardless of user_id
 */
async function deleteByProvenanceOrigin(origin: string): Promise<void> {
  console.log(`\n🗑️  Deleting all Sources with provenance.origin: ${origin}\n`);

  try {
    // Query Sources with matching provenance.origin
    // Note: provenance is stored as JSON string, so we need to parse it
    console.log('   Finding matching Sources...');
    const sourcesResult = await neo4jService.executeQuery<{
      entity_key: string;
      user_id: string;
      provenance: string;
    }>(
      `MATCH (s:Source)
       WHERE s.provenance IS NOT NULL
       AND s.provenance CONTAINS '"origin"'
       AND s.provenance CONTAINS $origin
       RETURN s.entity_key as entity_key, s.user_id as user_id, s.provenance as provenance`,
      { origin }
    );

    if (sourcesResult.length === 0) {
      console.log(`   ℹ️  No Sources found with provenance.origin: ${origin}`);
      return;
    }

    console.log(`   Found ${sourcesResult.length} Sources to delete`);

    // Delete Sources and their relationships
    console.log('   Deleting Sources...');
    const deleteResult = await neo4jService.executeQuery<{ count: number }>(
      `MATCH (s:Source)
       WHERE s.provenance IS NOT NULL
       AND s.provenance CONTAINS '"origin"'
       AND s.provenance CONTAINS $origin
       WITH s, count(s) as count
       DETACH DELETE s
       RETURN count`,
      { origin }
    );

    console.log(`   ✅ Deleted ${deleteResult[0]?.count ?? 0} Sources`);

    // Note: Semantic nodes (Person, Concept, Entity) are NOT deleted by this method
    // They remain in the graph even if their only mentions were from deleted Sources
    // To clean up orphaned semantic nodes, run deleteByUserId() separately

    console.log(`\n✅ Cleanup complete for provenance.origin: ${origin}`);
  } catch (error) {
    console.error(`\n❌ Cleanup failed for provenance.origin ${origin}:`, error);
    throw error;
  }
}

/**
 * Verify cleanup completion
 */
async function verifyCleanup(userId?: string, provenanceOrigin?: string): Promise<void> {
  console.log('\n📊 Verifying cleanup...\n');

  if (userId) {
    // Count remaining nodes for user
    const nodeCount = await neo4jService.executeQuery<{ label: string; count: number }>(
      `MATCH (n)
       WHERE n.user_id = $user_id
       RETURN labels(n)[0] as label, count(*) as count`,
      { user_id: userId }
    );

    if (nodeCount.length === 0) {
      console.log(`   ✅ No remaining nodes for user_id: ${userId}`);
    } else {
      console.log(`   ⚠️  Remaining nodes for user_id ${userId}:`);
      nodeCount.forEach((row) => {
        console.log(`      - ${row.label}: ${row.count}`);
      });
    }

    // Count remaining relationships for user
    const relCount = await neo4jService.executeQuery<{ rel_type: string; count: number }>(
      `MATCH ()-[r:has_relationship_with|engages_with|associated_with|relates_to|involves|connected_to {user_id: $user_id}]-()
       RETURN type(r) as rel_type, count(*) as count`,
      { user_id: userId }
    );

    if (relCount.length === 0 || relCount.every((r) => r.count === 0)) {
      console.log(`   ✅ No remaining semantic relationships for user_id: ${userId}`);
    } else {
      console.log(`   ⚠️  Remaining relationships for user_id ${userId}:`);
      relCount.forEach((row) => {
        if (row.count > 0) {
          console.log(`      - ${row.rel_type}: ${row.count}`);
        }
      });
    }
  }

  if (provenanceOrigin) {
    // Count remaining Sources with provenance.origin
    const sourceCount = await neo4jService.executeQuery<{ count: number }>(
      `MATCH (s:Source)
       WHERE s.provenance IS NOT NULL
       AND s.provenance CONTAINS '"origin"'
       AND s.provenance CONTAINS $origin
       RETURN count(*) as count`,
      { origin: provenanceOrigin }
    );

    const count = sourceCount[0]?.count ?? 0;
    if (count === 0) {
      console.log(`   ✅ No remaining Sources with provenance.origin: ${provenanceOrigin}`);
    } else {
      console.log(`   ⚠️  ${count} Sources still have provenance.origin: ${provenanceOrigin}`);
    }
  }

  console.log('');
}

// ============================================================================
// Main Cleanup Function
// ============================================================================

async function cleanupLoCoMoData(config: CleanupConfig) {
  console.log('🚀 LoCoMo Data Cleanup\n');
  console.log('Configuration:');
  console.log(`  User ID: ${config.userId ?? 'not specified'}`);
  console.log(`  Provenance Origin: ${config.provenanceOrigin ?? 'not specified'}`);
  console.log(`  Delete All: ${config.deleteAll ?? false}`);
  console.log('');

  if (!config.userId && !config.provenanceOrigin && !config.deleteAll) {
    throw new Error(
      'Must specify at least one of: --user-id, --provenance-origin, or --all'
    );
  }

  // Connect to Neo4j
  console.log('🔌 Connecting to Neo4j...');
  await neo4jService.connect();
  console.log('✅ Neo4j connected\n');

  try {
    // Delete by user_id if specified
    if (config.userId || config.deleteAll) {
      const userId = config.userId ?? 'locomo-eval-user'; // Default for --all
      await deleteByUserId(userId);
    }

    // Delete by provenance.origin if specified
    if (config.provenanceOrigin || config.deleteAll) {
      const origin = config.provenanceOrigin ?? 'locomo-eval'; // Default for --all
      await deleteByProvenanceOrigin(origin);
    }

    // Verify cleanup
    await verifyCleanup(
      config.userId ?? (config.deleteAll ? 'locomo-eval-user' : undefined),
      config.provenanceOrigin ?? (config.deleteAll ? 'locomo-eval' : undefined)
    );

    console.log('✅ Cleanup complete!\n');
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error);
    throw error;
  } finally {
    // Disconnect from Neo4j
    await neo4jService.close();
    console.log('🔌 Neo4j disconnected');
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const config: CleanupConfig = {};

  // Parse --user-id flag
  const userIdIndex = args.indexOf('--user-id');
  if (userIdIndex !== -1 && args[userIdIndex + 1]) {
    config.userId = args[userIdIndex + 1];
  }

  // Parse --provenance-origin flag
  const provenanceIndex = args.indexOf('--provenance-origin');
  if (provenanceIndex !== -1 && args[provenanceIndex + 1]) {
    config.provenanceOrigin = args[provenanceIndex + 1];
  }

  // Parse --all flag
  if (args.includes('--all')) {
    config.deleteAll = true;
  }

  cleanupLoCoMoData(config)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { cleanupLoCoMoData, deleteByUserId, deleteByProvenanceOrigin };

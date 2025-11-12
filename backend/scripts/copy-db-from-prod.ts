#!/usr/bin/env tsx

/**
 * Copy Neo4j Database from Production to Local
 *
 * This script:
 * 1. Exports all nodes and relationships from production Neo4j
 * 2. Deletes all data from local Neo4j
 * 3. Imports production data into local Neo4j
 *
 * Usage:
 *   tsx scripts/copy-db-from-prod.ts
 */

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import neo4j, { Driver } from 'neo4j-driver';

// Get __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load production environment
const prodEnv = config({ path: join(__dirname, '..', '.env.production') }).parsed || {};

// Load local environment (override with local .env)
const localEnv = config({ path: join(__dirname, '..', '.env') }).parsed || {};

interface NodeData {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

interface RelationshipData {
  id: string;
  type: string;
  startNodeId: string;
  endNodeId: string;
  properties: Record<string, unknown>;
}

async function exportFromProduction(driver: Driver): Promise<{
  nodes: NodeData[];
  relationships: RelationshipData[];
}> {
  console.log('📦 Exporting data from production...');
  const session = driver.session();

  try {
    // Export all nodes
    const nodesResult = await session.run(`
      MATCH (n)
      RETURN elementId(n) as id, labels(n) as labels, properties(n) as properties
    `);

    const nodes: NodeData[] = nodesResult.records.map((record) => ({
      id: record.get('id'),
      labels: record.get('labels'),
      properties: record.get('properties'),
    }));

    console.log(`   ✓ Exported ${nodes.length} nodes`);

    // Export all relationships
    const relsResult = await session.run(`
      MATCH (start)-[r]->(end)
      RETURN elementId(r) as id, type(r) as type,
             elementId(start) as startNodeId,
             elementId(end) as endNodeId,
             properties(r) as properties
    `);

    const relationships: RelationshipData[] = relsResult.records.map((record) => ({
      id: record.get('id'),
      type: record.get('type'),
      startNodeId: record.get('startNodeId'),
      endNodeId: record.get('endNodeId'),
      properties: record.get('properties'),
    }));

    console.log(`   ✓ Exported ${relationships.length} relationships\n`);

    return { nodes, relationships };
  } finally {
    await session.close();
  }
}

async function deleteLocalData(driver: Driver): Promise<void> {
  console.log('🗑️  Deleting local database...');
  const session = driver.session();

  try {
    // Delete all nodes and relationships
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('   ✓ All local nodes and relationships deleted');

    // Drop all constraints first (they own indexes)
    console.log('   Dropping constraints...');
    const constraints = await session.run('SHOW CONSTRAINTS');

    for (const record of constraints.records) {
      const constraintName = record.get('name');

      try {
        await session.run(`DROP CONSTRAINT ${constraintName} IF EXISTS`);
        console.log(`   ✓ Dropped constraint: ${constraintName}`);
      } catch (error) {
        console.warn(`   ⚠️  Failed to drop constraint ${constraintName}:`, error instanceof Error ? error.message : error);
      }
    }

    // Drop all indexes (constraints will be recreated by schema initialization)
    console.log('   Dropping indexes...');
    const indexes = await session.run('SHOW INDEXES');

    for (const record of indexes.records) {
      const indexName = record.get('name');
      const indexType = record.get('type');

      // Skip constraint-owned indexes (already handled)
      if (indexType !== 'RANGE' && indexType !== 'TEXT' && indexType !== 'VECTOR') {
        continue;
      }

      try {
        await session.run(`DROP INDEX ${indexName} IF EXISTS`);
        console.log(`   ✓ Dropped index: ${indexName}`);
      } catch (error) {
        // Constraint-owned indexes can't be dropped - that's okay
        if (error instanceof Error && !error.message.includes('belongs to constraint')) {
          console.warn(`   ⚠️  Failed to drop index ${indexName}:`, error.message);
        }
      }
    }

    console.log('   ✓ Schema cleaned\n');
  } finally {
    await session.close();
  }
}

async function importToLocal(
  driver: Driver,
  data: { nodes: NodeData[]; relationships: RelationshipData[] }
): Promise<void> {
  console.log('📥 Importing data to local...');
  const session = driver.session();

  try {
    // Create a mapping from old elementId to new elementId
    const idMap = new Map<string, string>();

    // Import nodes
    console.log('   Creating nodes...');
    let nodeCount = 0;

    for (const node of data.nodes) {
      const labels = node.labels.join(':');
      const labelsClause = labels ? `:${labels}` : '';

      const result = await session.run(
        `CREATE (n${labelsClause}) SET n = $properties RETURN elementId(n) as newId`,
        { properties: node.properties }
      );

      const newId = result.records[0].get('newId');
      idMap.set(node.id, newId);
      nodeCount++;

      if (nodeCount % 100 === 0) {
        console.log(`   ... ${nodeCount} nodes created`);
      }
    }

    console.log(`   ✓ Created ${nodeCount} nodes\n`);

    // Import relationships
    console.log('   Creating relationships...');
    let relCount = 0;

    for (const rel of data.relationships) {
      const startId = idMap.get(rel.startNodeId);
      const endId = idMap.get(rel.endNodeId);

      if (!startId || !endId) {
        console.warn(`   ⚠️  Skipping relationship ${rel.id} - nodes not found`);
        continue;
      }

      await session.run(
        `
        MATCH (start), (end)
        WHERE elementId(start) = $startId AND elementId(end) = $endId
        CREATE (start)-[r:${rel.type}]->(end)
        SET r = $properties
        `,
        {
          startId,
          endId,
          properties: rel.properties,
        }
      );

      relCount++;

      if (relCount % 100 === 0) {
        console.log(`   ... ${relCount} relationships created`);
      }
    }

    console.log(`   ✓ Created ${relCount} relationships\n`);
  } finally {
    await session.close();
  }
}

async function main() {
  console.log('🚀 Copying Neo4j database from production to local\n');

  // Validate environment variables
  if (!prodEnv.NEO4J_URI || !prodEnv.NEO4J_USERNAME || !prodEnv.NEO4J_PASSWORD) {
    console.error('❌ Missing production Neo4j credentials in .env.production');
    process.exit(1);
  }

  if (!localEnv.NEO4J_URI || !localEnv.NEO4J_USERNAME || !localEnv.NEO4J_PASSWORD) {
    console.error('❌ Missing local Neo4j credentials in .env');
    process.exit(1);
  }

  console.log('📡 Production Neo4j:');
  console.log(`   URI: ${prodEnv.NEO4J_URI}`);
  console.log(`   Username: ${prodEnv.NEO4J_USERNAME}\n`);

  console.log('💻 Local Neo4j:');
  console.log(`   URI: ${localEnv.NEO4J_URI}`);
  console.log(`   Username: ${localEnv.NEO4J_USERNAME}\n`);

  let prodDriver: Driver | null = null;
  let localDriver: Driver | null = null;

  try {
    // Connect to production
    console.log('🔌 Connecting to production...');
    prodDriver = neo4j.driver(
      prodEnv.NEO4J_URI,
      neo4j.auth.basic(prodEnv.NEO4J_USERNAME, prodEnv.NEO4J_PASSWORD)
    );
    await prodDriver.verifyConnectivity();
    console.log('   ✓ Connected to production\n');

    // Connect to local
    console.log('🔌 Connecting to local...');
    localDriver = neo4j.driver(
      localEnv.NEO4J_URI,
      neo4j.auth.basic(localEnv.NEO4J_USERNAME, localEnv.NEO4J_PASSWORD)
    );
    await localDriver.verifyConnectivity();
    console.log('   ✓ Connected to local\n');

    // Export from production
    const data = await exportFromProduction(prodDriver);

    // Delete local data
    await deleteLocalData(localDriver);

    // Import to local
    await importToLocal(localDriver, data);

    console.log('✅ Database copy complete!\n');
    console.log('📊 Summary:');
    console.log(`   - ${data.nodes.length} nodes copied`);
    console.log(`   - ${data.relationships.length} relationships copied\n`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    if (prodDriver) await prodDriver.close();
    if (localDriver) await localDriver.close();
  }
}

main().catch(console.error);

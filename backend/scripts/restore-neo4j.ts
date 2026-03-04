#!/usr/bin/env tsx

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { neo4jService } from '../src/db/neo4j.js';

// Parse environment flag first
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const useProd = args.includes('--prod');
const backupFile = args.find(arg => !arg.startsWith('--'));

if (!backupFile) {
  console.error('Usage: tsx scripts/restore-neo4j.ts <backup-file.json> [--prod]');
  console.error('Example: tsx scripts/restore-neo4j.ts backups/neo4j-backup-local-2025-11-20T12-00-00.json');
  process.exit(1);
}

// Load appropriate environment variables
const envPath = useProd
  ? join(__dirname, '..', '.env.production')
  : join(__dirname, '..', '.env');
config({ path: envPath });

interface Neo4jNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

interface Neo4jRelationship {
  id: string;
  type: string;
  startNode: string;
  endNode: string;
  properties: Record<string, unknown>;
}

interface BackupData {
  timestamp: string;
  environment: string;
  stats: {
    nodeCount: number;
    relationshipCount: number;
    labelCounts: Record<string, number>;
    relationshipTypeCounts: Record<string, number>;
  };
  nodes: Neo4jNode[];
  relationships: Neo4jRelationship[];
}

async function restore() {
  try {
    console.log(`Restoring Neo4j database from ${backupFile}...`);
    console.log(`Target environment: ${useProd ? 'PRODUCTION' : 'local'}\n`);

    // Read backup file
    const backupData: BackupData = JSON.parse(readFileSync(backupFile, 'utf-8'));

    console.log(`📋 Backup info:`);
    console.log(`   Created: ${backupData.timestamp}`);
    console.log(`   Environment: ${backupData.environment}`);
    console.log(`   Nodes: ${backupData.stats.nodeCount}`);
    console.log(`   Relationships: ${backupData.stats.relationshipCount}\n`);

    // Warning for cross-environment restore
    if (backupData.environment === 'production' && !useProd) {
      console.warn('⚠️  WARNING: Restoring PRODUCTION backup to LOCAL environment!');
    } else if (backupData.environment !== 'production' && useProd) {
      console.warn('⚠️  WARNING: Restoring LOCAL backup to PRODUCTION environment!');
    }

    // Confirm before proceeding
    console.log('⚠️  This will DELETE all existing data and restore from backup.');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await neo4jService.connect();

    // Clear existing database
    console.log('🗑️  Clearing existing database...');
    await neo4jService.executeQuery('MATCH (n) DETACH DELETE n');

    // Create mapping from old IDs to new nodes
    const nodeIdMap = new Map<string, string>();

    console.log(`📥 Restoring ${backupData.nodes.length} nodes...`);

    // Restore nodes in batches
    const batchSize = 100;
    for (let i = 0; i < backupData.nodes.length; i += batchSize) {
      const batch = backupData.nodes.slice(i, i + batchSize);

      for (const node of batch) {
        const labels = node.labels.join(':');
        const propsStr = Object.entries(node.properties)
          .map(([key, value]) => `${key}: $props.${key}`)
          .join(', ');

        const query = `
          CREATE (n:${labels} {${propsStr}})
          RETURN elementId(n) as newId
        `;

        const result = await neo4jService.executeQuery<{ newId: string }>(
          query,
          { props: node.properties }
        );

        if (result[0]) {
          nodeIdMap.set(node.id, result[0].newId);
        }
      }

      process.stdout.write(`\r   Progress: ${Math.min(i + batchSize, backupData.nodes.length)}/${backupData.nodes.length}`);
    }
    console.log(' ✅\n');

    console.log(`🔗 Restoring ${backupData.relationships.length} relationships...`);

    // Restore relationships in batches
    for (let i = 0; i < backupData.relationships.length; i += batchSize) {
      const batch = backupData.relationships.slice(i, i + batchSize);

      for (const rel of batch) {
        const startId = nodeIdMap.get(rel.startNode);
        const endId = nodeIdMap.get(rel.endNode);

        if (!startId || !endId) {
          console.warn(`\n⚠️  Skipping relationship ${rel.type}: missing node mapping`);
          continue;
        }

        const propsStr = Object.keys(rel.properties).length > 0
          ? `{${Object.entries(rel.properties).map(([key, value]) => `${key}: $props.${key}`).join(', ')}}`
          : '';

        const query = `
          MATCH (start), (end)
          WHERE elementId(start) = $startId AND elementId(end) = $endId
          CREATE (start)-[r:${rel.type} ${propsStr}]->(end)
        `;

        await neo4jService.executeQuery(query, {
          startId,
          endId,
          props: rel.properties,
        });
      }

      process.stdout.write(`\r   Progress: ${Math.min(i + batchSize, backupData.relationships.length)}/${backupData.relationships.length}`);
    }
    console.log(' ✅\n');

    // Verify restoration
    const verifyNodes = await neo4jService.executeQuery<{ count: number }>('MATCH (n) RETURN count(n) as count');
    const verifyRels = await neo4jService.executeQuery<{ count: number }>('MATCH ()-[r]->() RETURN count(r) as count');

    console.log('✅ Restoration completed successfully!\n');
    console.log('📊 Verification:');
    console.log(`   Nodes restored: ${Number(verifyNodes[0]?.count || 0)}/${backupData.stats.nodeCount}`);
    console.log(`   Relationships restored: ${Number(verifyRels[0]?.count || 0)}/${backupData.stats.relationshipCount}`);

    await neo4jService.close();
  } catch (error) {
    console.error('\n❌ Restoration failed:', error instanceof Error ? error.message : error);
    await neo4jService.close();
    process.exit(1);
  }
}

restore();

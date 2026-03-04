#!/usr/bin/env tsx

import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { neo4jService } from '../src/db/neo4j.js';

// Parse environment flag first
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const useProd = args.includes('--prod');

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

async function backup() {
  try {
    console.log(`Backing up Neo4j database (${useProd ? 'PRODUCTION' : 'local'})...`);

    await neo4jService.connect();

    // Get all nodes with their properties
    const nodesResult = await neo4jService.executeQuery<{
      id: string;
      labels: string[];
      properties: Record<string, unknown>;
    }>(`
      MATCH (n)
      RETURN
        elementId(n) as id,
        labels(n) as labels,
        properties(n) as properties
    `);

    // Get all relationships with their properties
    const relsResult = await neo4jService.executeQuery<{
      id: string;
      type: string;
      startNode: string;
      endNode: string;
      properties: Record<string, unknown>;
    }>(`
      MATCH (start)-[r]->(end)
      RETURN
        elementId(r) as id,
        type(r) as type,
        elementId(start) as startNode,
        elementId(end) as endNode,
        properties(r) as properties
    `);

    // Get statistics
    const labelCountsResult = await neo4jService.executeQuery<{
      label: string;
      count: number;
    }>(`
      MATCH (n)
      RETURN labels(n)[0] as label, count(n) as count
      ORDER BY count DESC
    `);

    const relTypeCountsResult = await neo4jService.executeQuery<{
      type: string;
      count: number;
    }>(`
      MATCH ()-[r]->()
      RETURN type(r) as type, count(r) as count
      ORDER BY count DESC
    `);

    // Build backup data structure
    const backupData: BackupData = {
      timestamp: new Date().toISOString(),
      environment: useProd ? 'production' : 'local',
      stats: {
        nodeCount: nodesResult.length,
        relationshipCount: relsResult.length,
        labelCounts: Object.fromEntries(
          labelCountsResult.map(r => [r.label, Number(r.count)])
        ),
        relationshipTypeCounts: Object.fromEntries(
          relTypeCountsResult.map(r => [r.type, Number(r.count)])
        ),
      },
      nodes: nodesResult,
      relationships: relsResult,
    };

    // Create backups directory if it doesn't exist
    const backupsDir = join(__dirname, '..', 'backups');
    if (!existsSync(backupsDir)) {
      mkdirSync(backupsDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const env = useProd ? 'prod' : 'local';
    const filename = `neo4j-backup-${env}-${timestamp}.json`;
    const filepath = join(backupsDir, filename);

    // Write backup file
    writeFileSync(filepath, JSON.stringify(backupData, null, 2));

    console.log('\n✅ Backup completed successfully!');
    console.log(`📁 File: ${filepath}`);
    console.log(`\n📊 Stats:`);
    console.log(`   Nodes: ${backupData.stats.nodeCount}`);
    console.log(`   Relationships: ${backupData.stats.relationshipCount}`);
    console.log(`\n🏷️  Label counts:`);
    Object.entries(backupData.stats.labelCounts).forEach(([label, count]) => {
      console.log(`   ${label}: ${count}`);
    });
    console.log(`\n🔗 Relationship counts:`);
    Object.entries(backupData.stats.relationshipTypeCounts).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    await neo4jService.close();
  } catch (error) {
    console.error('❌ Backup failed:', error instanceof Error ? error.message : error);
    await neo4jService.close();
    process.exit(1);
  }
}

backup();

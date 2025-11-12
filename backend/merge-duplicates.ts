#!/usr/bin/env tsx

import { config } from 'dotenv';
import { neo4jService } from './src/db/neo4j.js';

config();

async function mergeDuplicatePersons() {
  await neo4jService.connect();

  try {
    // Merge Silas Rainier nodes for user e67ea3c1-8223-4bc2-a06b-8220f57ae934
    const oldKey = 'd1beffeafd8179c03a6cb89037db55854ea2c665cf0c82c8b4be753885cf68d8';
    const newKey = '7f00db35e88e6e7476f1ad8f11a8970199dccaa4fc6c79917200d22c5d993439';

    console.log('Merging duplicate Silas Rainier nodes...');
    console.log(`  Old node: ${oldKey}`);
    console.log(`  New node (owner): ${newKey}`);

    // Get all outgoing relationships from old node
    const outgoingResult = await neo4jService.executeRaw(`
      MATCH (old:Person {entity_key: $oldKey})-[r]->(target)
      RETURN type(r) as relType, properties(r) as props, elementId(target) as targetId
    `, { oldKey });

    console.log(`\nFound ${outgoingResult.length} outgoing relationships to transfer`);

    // Transfer each outgoing relationship
    for (const record of outgoingResult) {
      const relType = record.get('relType');
      const props = record.get('props');
      const targetId = record.get('targetId');

      await neo4jService.executeRaw(`
        MATCH (new:Person {entity_key: $newKey})
        MATCH (target)
        WHERE elementId(target) = $targetId
        MERGE (new)-[r:${relType}]->(target)
        SET r = $props
      `, { newKey, targetId, props });

      console.log(`  ✓ Transferred [${relType}] relationship`);
    }

    // Get all incoming relationships to old node
    const incomingResult = await neo4jService.executeRaw(`
      MATCH (source)-[r]->(old:Person {entity_key: $oldKey})
      RETURN type(r) as relType, properties(r) as props, elementId(source) as sourceId
    `, { oldKey });

    console.log(`\nFound ${incomingResult.length} incoming relationships to transfer`);

    // Transfer each incoming relationship
    for (const record of incomingResult) {
      const relType = record.get('relType');
      const props = record.get('props');
      const sourceId = record.get('sourceId');

      await neo4jService.executeRaw(`
        MATCH (new:Person {entity_key: $newKey})
        MATCH (source)
        WHERE elementId(source) = $sourceId
        MERGE (source)-[r:${relType}]->(new)
        SET r = $props
      `, { newKey, sourceId, props });

      console.log(`  ✓ Transferred [${relType}] relationship`);
    }

    // Delete the old node
    await neo4jService.executeRaw(`
      MATCH (old:Person {entity_key: $oldKey})
      DETACH DELETE old
    `, { oldKey });

    console.log('\n✅ Successfully merged duplicate Silas Rainier nodes');

    // Verify the merge
    const verifyResult = await neo4jService.executeRaw(`
      MATCH (p:Person {entity_key: $newKey})-[r]-(n)
      RETURN count(r) as totalRelationships
    `, { newKey });

    const totalRels = verifyResult[0].get('totalRelationships').toNumber();
    console.log(`\nVerification: New owner node now has ${totalRels} relationships`);

  } finally {
    await neo4jService.close();
  }
}

async function removeDevicePersonNode() {
  await neo4jService.connect();

  try {
    console.log('\n\nRemoving redundant "Device silas-te" Person node...');

    // Check if it has any relationships
    const checkResult = await neo4jService.executeRaw(`
      MATCH (p:Person {canonical_name: 'device silas-te'})-[r]-(n)
      RETURN count(r) as relCount
    `);

    const relCount = checkResult[0]?.get('relCount')?.toNumber() || 0;

    if (relCount > 0) {
      console.log(`  Warning: Node has ${relCount} relationships. Not deleting.`);
    } else {
      await neo4jService.executeRaw(`
        MATCH (p:Person {canonical_name: 'device silas-te'})
        DELETE p
      `);
      console.log('  ✓ Deleted device node (had no relationships)');
    }

  } finally {
    await neo4jService.close();
  }
}

async function main() {
  try {
    await mergeDuplicatePersons();
    await removeDevicePersonNode();
    console.log('\n🎉 All duplicates merged successfully!');
  } catch (error) {
    console.error('Error:', error);
    await neo4jService.close();
    process.exit(1);
  }
}

main();

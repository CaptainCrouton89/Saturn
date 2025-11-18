/**
 * Neo4j Database Reset Script
 *
 * This script completely wipes the Neo4j database (all data, constraints, and indexes).
 * Schema initialization happens automatically when the server starts (via src/db/schema.ts).
 *
 * DANGER: This deletes ALL data!
 *
 * Usage:
 *   node scripts/reset-neo4j.js
 *
 * Or with Railway:
 *   railway run node scripts/reset-neo4j.js
 */

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

async function resetNeo4j() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    console.error('❌ Error: Missing Neo4j credentials');
    console.error('   Please set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD environment variables');
    process.exit(1);
  }

  console.log('🔧 Resetting Neo4j database...');
  console.log(`   URI: ${uri}`);
  console.log(`   Username: ${username}\n`);

  let driver;

  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    await driver.verifyConnectivity();
    console.log('✅ Connected to Neo4j\n');

    const session = driver.session();

    try {
      // Step 1: Delete all data
      console.log('🗑️  Deleting all existing data...');
      await session.run('MATCH (n) DETACH DELETE n');
      console.log('   ✓ All nodes and relationships deleted\n');

      // Step 2: Drop all constraints
      console.log('🔧 Dropping all constraints...');
      const constraints = await session.run('SHOW CONSTRAINTS');
      let constraintCount = 0;
      for (const constraint of constraints.records) {
        const constraintName = constraint.get('name');
        try {
          await session.run(`DROP CONSTRAINT ${constraintName}`);
          constraintCount++;
        } catch (error) {
          console.log(`   ⚠️  Failed to drop constraint ${constraintName}: ${error.message}`);
        }
      }
      console.log(`   ✓ Dropped ${constraintCount} constraints\n`);

      // Step 3: Drop all indexes
      console.log('🔧 Dropping all indexes...');
      const indexes = await session.run('SHOW INDEXES');
      let indexCount = 0;
      for (const index of indexes.records) {
        const indexName = index.get('name');
        // Skip constraint-backed indexes (they're already dropped with constraints)
        const indexType = index.get('type');
        if (indexType && indexType.includes('UNIQUE')) {
          continue;
        }
        try {
          await session.run(`DROP INDEX ${indexName} IF EXISTS`);
          indexCount++;
        } catch (error) {
          console.log(`   ⚠️  Failed to drop index ${indexName}: ${error.message}`);
        }
      }
      console.log(`   ✓ Dropped ${indexCount} indexes\n`);

      console.log('✅ Database reset complete! Database is now empty.\n');
      console.log('   Schema (constraints & indexes) will be created automatically when the server starts.\n');

    } finally {
      await session.close();
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (driver) {
      await driver.close();
    }
  }
}

resetNeo4j().catch(console.error);

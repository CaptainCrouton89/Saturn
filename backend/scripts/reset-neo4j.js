/**
 * Neo4j Database Reset Script
 *
 * This script completely wipes the Neo4j database and sets up indexes.
 * Does NOT populate any sample data.
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

const indexQueries = [
  // Entity Key Indexes (Critical for Idempotency)
  'CREATE INDEX entity_key_person IF NOT EXISTS FOR (p:Person) ON (p.entity_key)',
  'CREATE INDEX entity_key_project IF NOT EXISTS FOR (p:Project) ON (p.entity_key)',
  'CREATE INDEX entity_key_topic IF NOT EXISTS FOR (t:Topic) ON (t.entity_key)',
  'CREATE INDEX entity_key_idea IF NOT EXISTS FOR (i:Idea) ON (i.entity_key)',
  'CREATE INDEX entity_key_pattern IF NOT EXISTS FOR (p:Pattern) ON (p.entity_key)',
  'CREATE INDEX entity_key_value IF NOT EXISTS FOR (v:Value) ON (v.entity_key)',

  // Canonical Name Indexes (For Name Matching)
  'CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name)',
  'CREATE INDEX project_canonical_name IF NOT EXISTS FOR (p:Project) ON (p.canonical_name)',
  'CREATE INDEX topic_canonical_name IF NOT EXISTS FOR (t:Topic) ON (t.canonical_name)',

  // Alias Indexes (For Entity Resolution)
  'CREATE INDEX alias_normalized_name IF NOT EXISTS FOR (a:Alias) ON (a.normalized_name)',
  'CREATE INDEX alias_type IF NOT EXISTS FOR (a:Alias) ON (a.type)',

  // Name Indexes (For Fuzzy Search)
  'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)',
  'CREATE INDEX project_name IF NOT EXISTS FOR (p:Project) ON (p.name)',
  'CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name)',

  // ID Indexes (For Direct Lookups)
  'CREATE INDEX person_id IF NOT EXISTS FOR (p:Person) ON (p.id)',
  'CREATE INDEX project_id IF NOT EXISTS FOR (p:Project) ON (p.id)',
  'CREATE INDEX topic_id IF NOT EXISTS FOR (t:Topic) ON (t.id)',
  'CREATE INDEX idea_id IF NOT EXISTS FOR (i:Idea) ON (i.id)',
  'CREATE INDEX conversation_id IF NOT EXISTS FOR (c:Conversation) ON (c.id)',
  'CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id)',
  'CREATE INDEX note_id IF NOT EXISTS FOR (n:Note) ON (n.id)',
  'CREATE INDEX artifact_id IF NOT EXISTS FOR (a:Artifact) ON (a.id)',

  // Category Index (For Filtering)
  'CREATE INDEX topic_category IF NOT EXISTS FOR (t:Topic) ON (t.category)',

  // NOTE: Removed project_status and idea_status indexes - these are now relationship properties!
];

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

      // Step 2: Drop old indexes that no longer apply
      console.log('🔧 Dropping obsolete indexes...');
      try {
        await session.run('DROP INDEX project_status IF EXISTS');
        await session.run('DROP INDEX idea_status IF EXISTS');
        console.log('   ✓ Obsolete indexes dropped\n');
      } catch (error) {
        console.log('   ⚠️  No obsolete indexes to drop\n');
      }

      // Step 3: Create indexes
      console.log('📝 Creating indexes...\n');
      let successCount = 0;
      for (const query of indexQueries) {
        try {
          await session.run(query);
          const match = query.match(/INDEX (\w+)/);
          const indexName = match ? match[1] : 'unknown';
          console.log(`   ✓ Created: ${indexName}`);
          successCount++;
        } catch (error) {
          console.error(`   ✗ Failed: ${query}`);
          console.error(`     Error: ${error.message}`);
        }
      }
      console.log(`\n   Total indexes created: ${successCount}\n`);

      console.log('✅ Database reset complete! Database is now empty with indexes ready.\n');

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

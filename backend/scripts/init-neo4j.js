/**
 * Neo4j Database Initialization Script
 *
 * This script creates all necessary indexes and constraints for the Saturn Backend.
 * Run this after deploying to Railway or setting up a new Neo4j instance.
 *
 * Usage:
 *   node scripts/init-neo4j.js
 *
 * Or with Railway:
 *   railway run node scripts/init-neo4j.js
 */

require('dotenv').config();
const neo4j = require('neo4j-driver');

const queries = [
  // ============================================================================
  // Entity Key Indexes (Critical for Idempotency)
  // ============================================================================
  'CREATE INDEX entity_key_person IF NOT EXISTS FOR (p:Person) ON (p.entity_key)',
  'CREATE INDEX entity_key_project IF NOT EXISTS FOR (p:Project) ON (p.entity_key)',
  'CREATE INDEX entity_key_topic IF NOT EXISTS FOR (t:Topic) ON (t.entity_key)',
  'CREATE INDEX entity_key_idea IF NOT EXISTS FOR (i:Idea) ON (i.entity_key)',
  'CREATE INDEX entity_key_pattern IF NOT EXISTS FOR (p:Pattern) ON (p.entity_key)',
  'CREATE INDEX entity_key_value IF NOT EXISTS FOR (v:Value) ON (v.entity_key)',

  // ============================================================================
  // Canonical Name Indexes (For Name Matching)
  // ============================================================================
  'CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name)',
  'CREATE INDEX project_canonical_name IF NOT EXISTS FOR (p:Project) ON (p.canonical_name)',
  'CREATE INDEX topic_canonical_name IF NOT EXISTS FOR (t:Topic) ON (t.canonical_name)',

  // ============================================================================
  // Alias Indexes (For Entity Resolution)
  // ============================================================================
  'CREATE INDEX alias_normalized_name IF NOT EXISTS FOR (a:Alias) ON (a.normalized_name)',
  'CREATE INDEX alias_type IF NOT EXISTS FOR (a:Alias) ON (a.type)',

  // ============================================================================
  // Name Indexes (For Fuzzy Search)
  // ============================================================================
  'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)',
  'CREATE INDEX project_name IF NOT EXISTS FOR (p:Project) ON (p.name)',
  'CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name)',

  // ============================================================================
  // ID Indexes (For Direct Lookups)
  // ============================================================================
  'CREATE INDEX person_id IF NOT EXISTS FOR (p:Person) ON (p.id)',
  'CREATE INDEX project_id IF NOT EXISTS FOR (p:Project) ON (p.id)',
  'CREATE INDEX topic_id IF NOT EXISTS FOR (t:Topic) ON (t.id)',
  'CREATE INDEX idea_id IF NOT EXISTS FOR (i:Idea) ON (i.id)',
  'CREATE INDEX conversation_id IF NOT EXISTS FOR (c:Conversation) ON (c.id)',
  'CREATE INDEX user_id IF NOT EXISTS FOR (u:User) ON (u.id)',
  'CREATE INDEX note_id IF NOT EXISTS FOR (n:Note) ON (n.id)',
  'CREATE INDEX artifact_id IF NOT EXISTS FOR (a:Artifact) ON (a.id)',

  // ============================================================================
  // Status and Category Indexes (For Filtering)
  // ============================================================================
  'CREATE INDEX project_status IF NOT EXISTS FOR (p:Project) ON (p.status)',
  'CREATE INDEX idea_status IF NOT EXISTS FOR (i:Idea) ON (i.status)',
  'CREATE INDEX topic_category IF NOT EXISTS FOR (t:Topic) ON (t.category)',
];

async function initializeNeo4j() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    console.error('❌ Error: Missing Neo4j credentials');
    console.error('   Please set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD environment variables');
    process.exit(1);
  }

  console.log('🔧 Initializing Neo4j database...');
  console.log(`   URI: ${uri}`);
  console.log(`   Username: ${username}\n`);

  let driver;

  try {
    // Create driver
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

    // Verify connectivity
    await driver.verifyConnectivity();
    console.log('✅ Connected to Neo4j\n');

    // Create session
    const session = driver.session();

    try {
      // Execute each index creation query
      console.log('📝 Creating indexes and constraints...\n');

      let successCount = 0;
      let errorCount = 0;

      for (const query of queries) {
        try {
          await session.run(query);
          // Extract index name from query for better logging
          const match = query.match(/INDEX (\w+)/);
          const indexName = match ? match[1] : 'unknown';
          console.log(`   ✓ Created: ${indexName}`);
          successCount++;
        } catch (error) {
          console.error(`   ✗ Failed: ${query}`);
          console.error(`     Error: ${error.message}`);
          errorCount++;
        }
      }

      console.log(`\n📊 Summary:`);
      console.log(`   ✅ Success: ${successCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);

      // Verify indexes were created
      console.log('\n🔍 Verifying indexes...');
      const result = await session.run('SHOW INDEXES');
      console.log(`   Total indexes: ${result.records.length}`);

      console.log('\n✅ Neo4j initialization complete!');
      console.log('\n💡 Next steps:');
      console.log('   1. Verify indexes in Neo4j Browser');
      console.log('   2. Test your backend API endpoints');
      console.log('   3. Start using the graph database!\n');

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

// Run initialization
initializeNeo4j().catch(console.error);

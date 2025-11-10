/**
 * Neo4j Database Reset Script
 *
 * This script completely wipes the Neo4j database and reinitializes it with
 * the NEW schema structure (after migration from migration.md).
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

      // Step 4: Create sample data with NEW schema
      console.log('📊 Creating sample data with new schema...\n');

      // Create User
      await session.run(`
        CREATE (u:User {
          id: 'test-user-123',
          name: 'Test User',
          created_at: datetime()
        })
      `);
      console.log('   ✓ Created User');

      // Create People with KNOWS relationships (user-specific props on relationship!)
      await session.run(`
        MATCH (u:User {id: 'test-user-123'})
        CREATE (p1:Person {
          id: 'person-1',
          entity_key: 'sarah_johnson_person_test-user-123',
          name: 'Sarah Johnson',
          canonical_name: 'sarah johnson',
          personality_traits: ['thoughtful', 'analytical', 'creative'],
          current_life_situation: 'Starting a new job at a tech startup',
          updated_at: datetime(),
          last_update_source: 'conv-001',
          confidence: 0.9,
          excerpt_span: 'turns 1-3'
        }),
        (p2:Person {
          id: 'person-2',
          entity_key: 'mike_chen_person_test-user-123',
          name: 'Mike Chen',
          canonical_name: 'mike chen',
          personality_traits: ['energetic', 'optimistic', 'collaborative'],
          current_life_situation: 'Training for a marathon',
          updated_at: datetime(),
          last_update_source: 'conv-002',
          confidence: 0.85,
          excerpt_span: 'turns 5-7'
        }),
        (u)-[:KNOWS {
          relationship_type: 'colleague',
          relationship_quality: 0.8,
          how_they_met: 'Met at a tech conference in 2023',
          why_they_matter: 'Great collaborator on side projects',
          relationship_status: 'growing',
          communication_cadence: 'weekly slack messages',
          first_mentioned_at: datetime('2024-01-15T10:00:00Z'),
          last_mentioned_at: datetime('2024-11-10T15:30:00Z')
        }]->(p1),
        (u)-[:KNOWS {
          relationship_type: 'friend',
          relationship_quality: 0.95,
          how_they_met: 'College roommate',
          why_they_matter: 'Always there when I need advice',
          relationship_status: 'stable',
          communication_cadence: 'daily texts',
          first_mentioned_at: datetime('2024-01-10T09:00:00Z'),
          last_mentioned_at: datetime('2024-11-09T20:15:00Z')
        }]->(p2)
      `);
      console.log('   ✓ Created 2 People with KNOWS relationships');

      // Create Projects with WORKING_ON relationships (user-specific props on relationship!)
      await session.run(`
        MATCH (u:User {id: 'test-user-123'})
        CREATE (proj1:Project {
          id: 'project-1',
          entity_key: 'ai_companion_project_test-user-123',
          name: 'AI Companion App',
          canonical_name: 'ai companion app',
          domain: 'startup',
          vision: 'Build an AI that asks better questions than ChatGPT',
          key_decisions: ['Using Neo4j for memory', 'Voice-first interface'],
          last_update_source: 'conv-003',
          confidence: 0.9,
          excerpt_span: 'turns 10-15'
        }),
        (proj2:Project {
          id: 'project-2',
          entity_key: 'personal_website_project_test-user-123',
          name: 'Personal Website Redesign',
          canonical_name: 'personal website redesign',
          domain: 'personal',
          vision: 'Create a minimal, fast portfolio site',
          key_decisions: ['Using Astro', 'No analytics'],
          last_update_source: 'conv-004',
          confidence: 0.8,
          excerpt_span: 'turns 20-22'
        }),
        (u)-[:WORKING_ON {
          status: 'active',
          priority: 1,
          last_discussed_at: datetime('2024-11-10T14:00:00Z'),
          confidence_level: 0.85,
          excitement_level: 0.95,
          time_invested: 'about 3 months full-time',
          money_invested: 5000.0,
          blockers: ['Need to finalize Neo4j schema', 'iOS app build issues'],
          first_mentioned_at: datetime('2024-08-15T10:00:00Z'),
          last_mentioned_at: datetime('2024-11-10T14:00:00Z')
        }]->(proj1),
        (u)-[:WORKING_ON {
          status: 'paused',
          priority: 3,
          last_discussed_at: datetime('2024-10-20T11:00:00Z'),
          confidence_level: 0.6,
          excitement_level: 0.4,
          time_invested: 'a few weekends',
          money_invested: 0.0,
          blockers: ['Need to decide on design direction'],
          first_mentioned_at: datetime('2024-09-01T16:00:00Z'),
          last_mentioned_at: datetime('2024-10-20T11:00:00Z')
        }]->(proj2)
      `);
      console.log('   ✓ Created 2 Projects with WORKING_ON relationships');

      // Create Ideas with EXPLORING relationships (NEW! user-specific props on relationship)
      await session.run(`
        MATCH (u:User {id: 'test-user-123'})
        CREATE (idea1:Idea {
          id: 'idea-1',
          entity_key: 'voice_journaling_idea_test-user-123',
          summary: 'Voice-based journaling app that asks reflective questions',
          original_inspiration: 'Realized I think better when talking out loud',
          evolution_notes: 'Started as simple voice notes, evolved to conversational format',
          obstacles: ['Voice recognition accuracy', 'Question generation quality'],
          resources_needed: ['Speech-to-text API', 'Question database'],
          experiments_tried: ['Tested with Whisper API', 'Tried LLM for question generation'],
          context_notes: 'Could be standalone or part of Cosmo',
          created_at: datetime('2024-10-01T10:00:00Z'),
          updated_at: datetime('2024-11-05T15:00:00Z'),
          last_update_source: 'conv-005',
          confidence: 0.8,
          excerpt_span: 'turns 25-30'
        }),
        (u)-[:EXPLORING {
          status: 'refined',
          confidence_level: 0.75,
          excitement_level: 0.85,
          potential_impact: 'Could be a major feature in Cosmo or standalone product',
          next_steps: ['Build prototype', 'Test with 5 friends', 'Decide if standalone or integrated'],
          first_mentioned_at: datetime('2024-10-01T10:00:00Z'),
          last_mentioned_at: datetime('2024-11-05T15:00:00Z')
        }]->(idea1)
      `);
      console.log('   ✓ Created 1 Idea with EXPLORING relationship (NEW!)');

      // Create Topics with INTERESTED_IN relationships
      await session.run(`
        MATCH (u:User {id: 'test-user-123'})
        CREATE (topic1:Topic {
          id: 'topic-1',
          entity_key: 'knowledge_graphs_topic_test-user-123',
          name: 'Knowledge Graphs',
          canonical_name: 'knowledge graphs',
          description: 'Graph databases and semantic memory systems',
          category: 'technical',
          last_update_source: 'conv-006',
          confidence: 0.9,
          excerpt_span: 'turns 1-5'
        }),
        (topic2:Topic {
          id: 'topic-2',
          entity_key: 'ai_ethics_topic_test-user-123',
          name: 'AI Ethics',
          canonical_name: 'ai ethics',
          description: 'Ethical implications of AI systems',
          category: 'philosophical',
          last_update_source: 'conv-007',
          confidence: 0.85,
          excerpt_span: 'turns 10-15'
        }),
        (u)-[:INTERESTED_IN {
          engagement_level: 0.9,
          last_discussed_at: datetime('2024-11-10T16:00:00Z'),
          frequency: 15,
          first_mentioned_at: datetime('2024-08-20T10:00:00Z'),
          last_mentioned_at: datetime('2024-11-10T16:00:00Z')
        }]->(topic1),
        (u)-[:INTERESTED_IN {
          engagement_level: 0.7,
          last_discussed_at: datetime('2024-10-25T14:00:00Z'),
          frequency: 8,
          first_mentioned_at: datetime('2024-09-15T11:00:00Z'),
          last_mentioned_at: datetime('2024-10-25T14:00:00Z')
        }]->(topic2)
      `);
      console.log('   ✓ Created 2 Topics with INTERESTED_IN relationships');

      console.log('\n✅ Database reset complete!\n');
      console.log('📊 Sample data created:');
      console.log('   - 1 User');
      console.log('   - 2 People (with KNOWS relationships)');
      console.log('   - 2 Projects (with WORKING_ON relationships)');
      console.log('   - 1 Idea (with EXPLORING relationship - NEW!)');
      console.log('   - 2 Topics (with INTERESTED_IN relationships)');
      console.log('\n💡 Note: All user-specific properties are now on RELATIONSHIPS, not nodes!\n');

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

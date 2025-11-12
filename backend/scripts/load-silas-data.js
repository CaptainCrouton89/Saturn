/**
 * Load minimal data for Silas Rhyneer
 */

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'neo4j://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USERNAME || 'neo4j',
    process.env.NEO4J_PASSWORD || 'testpassword'
  )
);

async function main() {
  const session = driver.session();

  try {
    console.log('🧹 Clearing existing data...');
    await session.run('MATCH (n) DETACH DELETE n');

    console.log('👤 Creating User node for Silas Rhyneer...');
    await session.run(`
      CREATE (u:User {
        id: '87e4060b-83d5-468e-baf9-ebd6e569ecb7',
        name: 'Silas Rhyneer',
        created_at: datetime()
      })
    `);

    console.log('👥 Creating minimal Person example...');
    await session.run(`
      MATCH (u:User {id: '87e4060b-83d5-468e-baf9-ebd6e569ecb7'})
      CREATE (p:Person {
        id: 'person-alex',
        entity_key: 'alex_person_87e4060b-83d5-468e-baf9-ebd6e569ecb7',
        name: 'Alex',
        canonical_name: 'alex',
        personality_traits: ['creative', 'analytical'],
        current_life_situation: 'Working on side projects',
        updated_at: datetime(),
        last_update_source: 'demo-data',
        confidence: 0.9
      }),
      (u)-[:KNOWS {
        relationship_type: 'friend',
        relationship_quality: 0.85,
        how_they_met: 'College',
        why_they_matter: 'Great collaborator',
        relationship_status: 'active',
        communication_cadence: 'weekly',
        first_mentioned_at: datetime(),
        last_mentioned_at: datetime()
      }]->(p)
    `);

    console.log('📁 Creating minimal Project example...');
    await session.run(`
      MATCH (u:User {id: '87e4060b-83d5-468e-baf9-ebd6e569ecb7'})
      CREATE (proj:Project {
        id: 'project-cosmo',
        entity_key: 'cosmo_project_87e4060b-83d5-468e-baf9-ebd6e569ecb7',
        name: 'Cosmo',
        canonical_name: 'cosmo',
        domain: 'ai-startup',
        vision: 'AI companion that asks questions',
        key_decisions: ['Neo4j for memory', 'Voice-first'],
        last_update_source: 'demo-data',
        confidence: 1.0
      }),
      (u)-[:WORKING_ON {
        status: 'active',
        priority: 1,
        last_discussed_at: datetime(),
        confidence_level: 1.0,
        excitement_level: 0.95,
        time_invested: 'several months',
        money_invested: 0.0,
        blockers: [],
        first_mentioned_at: datetime(),
        last_mentioned_at: datetime()
      }]->(proj)
    `);

    console.log('📚 Creating minimal Topic example...');
    await session.run(`
      MATCH (u:User {id: '87e4060b-83d5-468e-baf9-ebd6e569ecb7'})
      CREATE (t:Topic {
        id: 'topic-ai',
        entity_key: 'ai_development_topic_87e4060b-83d5-468e-baf9-ebd6e569ecb7',
        name: 'AI Development',
        canonical_name: 'ai development',
        category: 'technology',
        description: 'Building AI-powered applications',
        last_update_source: 'demo-data',
        confidence: 0.9
      }),
      (u)-[:INTERESTED_IN {
        interest_level: 0.95,
        engagement_frequency: 'daily',
        first_mentioned_at: datetime(),
        last_mentioned_at: datetime()
      }]->(t)
    `);

    console.log('\n✅ Successfully loaded minimal data for Silas Rhyneer');
    console.log('\nData loaded:');
    console.log('  - 1 User (Silas Rhyneer)');
    console.log('  - 1 Person (Alex - friend)');
    console.log('  - 1 Project (Cosmo)');
    console.log('  - 1 Topic (AI Development)');
    console.log('\n📝 User ID: 87e4060b-83d5-468e-baf9-ebd6e569ecb7');
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);

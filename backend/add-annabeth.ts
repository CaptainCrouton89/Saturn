#!/usr/bin/env tsx

import { config } from 'dotenv';
import { createHash } from 'crypto';
import { neo4jService } from './src/db/neo4j.js';

config();

function generateEntityKey(name: string, type: string, userId: string): string {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const input = `${normalizedName}_${type}_${userId}`;
  return createHash('sha256').update(input).digest('hex');
}

async function main() {
  await neo4jService.connect();

  try {
    const userId = 'e67ea3c1-8223-4bc2-a06b-8220f57ae934';
    const annabethKey = generateEntityKey('annabeth', 'person', userId);

    console.log('Creating Annabeth node and relationships...\n');

    // 1. Create Annabeth Person node
    await neo4jService.executeRaw(`
      CREATE (p:Person {
        entity_key: $entity_key,
        user_id: $user_id,
        name: 'Annabeth',
        situation: 'Actively building multiple projects and startups',
        personality: 'Entrepreneurial, driven, collaborative',
        expertise: 'Product development, startup strategy',
        interests: 'Technology, entrepreneurship, building products',
        created_at: datetime(),
        updated_at: datetime(),
        notes: 'Close collaborator on multiple startup projects. Brings strong product and execution skills to joint ventures.'
      })
      RETURN p.name
    `, { entity_key: annabethKey, user_id: userId });

    console.log('✓ Created Annabeth person node');
    console.log(`  entity_key: ${annabethKey}\n`);

    // 2. Get Silas Rainier owner node key
    const ownerKey = '7f00db35e88e6e7476f1ad8f11a8970199dccaa4fc6c79917200d22c5d993439';

    // 3. Create relationship: Silas [has_relationship_with] Annabeth
    await neo4jService.executeRaw(`
      MATCH (owner:Person {entity_key: $ownerKey})
      MATCH (annabeth:Person {entity_key: $annabethKey})
      CREATE (owner)-[r:has_relationship_with {
        attitude_towards_person: 'friendly',
        closeness: 4,
        relationship_type: 'friend',
        notes: 'Close collaborator and co-founder on multiple startup projects. Strong working relationship built on trust and complementary skills.',
        created_at: datetime(),
        updated_at: datetime()
      }]->(annabeth)
      RETURN type(r)
    `, { ownerKey, annabethKey });

    console.log('✓ Created relationship: Silas [has_relationship_with] Annabeth');

    // 4. Create new Concept: "Joint Startup Projects"
    const projectsKey = generateEntityKey('joint_startup_projects', 'concept', userId);
    await neo4jService.executeRaw(`
      CREATE (c:Concept {
        entity_key: $entity_key,
        user_id: $user_id,
        name: 'Joint Startup Projects',
        description: 'Multiple startup projects being built collaboratively with Annabeth',
        created_at: datetime(),
        updated_at: datetime(),
        notes: 'Working on several ventures together, combining technical and product expertise. Projects in various stages from ideation to active development.'
      })
      RETURN c.name
    `, { entity_key: projectsKey, user_id: userId });

    console.log('✓ Created concept: Joint Startup Projects');
    console.log(`  entity_key: ${projectsKey}\n`);

    // 5. Owner [thinks_about] Joint Startup Projects
    await neo4jService.executeRaw(`
      MATCH (owner:Person {entity_key: $ownerKey})
      MATCH (concept:Concept {entity_key: $projectsKey})
      CREATE (owner)-[r:thinks_about {
        mood: 'excited_by',
        frequency: 25,
        created_at: datetime(),
        updated_at: datetime()
      }]->(concept)
      RETURN type(r)
    `, { ownerKey, projectsKey });

    console.log('✓ Created: Owner [thinks_about] Joint Startup Projects');

    // 6. Joint Startup Projects [involves] Annabeth
    await neo4jService.executeRaw(`
      MATCH (concept:Concept {entity_key: $projectsKey})
      MATCH (annabeth:Person {entity_key: $annabethKey})
      CREATE (concept)-[r:involves {
        notes: 'Annabeth is co-founder and key collaborator on these projects',
        relevance: 10,
        created_at: datetime(),
        updated_at: datetime()
      }]->(annabeth)
      RETURN type(r)
    `, { projectsKey, annabethKey });

    console.log('✓ Created: Joint Startup Projects [involves] Annabeth');

    // 7. Joint Startup Projects [relates_to] Startup concept
    const startupKey = 'cbab44695a41ba30e189b794ae524117a43d7f82849737dcf5ed5ab800eacca8';
    await neo4jService.executeRaw(`
      MATCH (projects:Concept {entity_key: $projectsKey})
      MATCH (startup:Concept {entity_key: $startupKey})
      CREATE (projects)-[r:relates_to {
        notes: 'Joint projects are part of overall startup career path exploration',
        relevance: 9,
        created_at: datetime(),
        updated_at: datetime()
      }]->(startup)
      RETURN type(r)
    `, { projectsKey, startupKey });

    console.log('✓ Created: Joint Startup Projects [relates_to] Startup');

    // 8. Joint Startup Projects [relates_to] Career Development
    const careerKey = 'ac374c1069acf0f929ee385123f1d365d3206b09605c890f37874b7fb581499c';
    await neo4jService.executeRaw(`
      MATCH (projects:Concept {entity_key: $projectsKey})
      MATCH (career:Concept {entity_key: $careerKey})
      CREATE (projects)-[r:relates_to {
        notes: 'Building projects with Annabeth is one approach to career development',
        relevance: 9,
        created_at: datetime(),
        updated_at: datetime()
      }]->(career)
      RETURN type(r)
    `, { projectsKey, careerKey });

    console.log('✓ Created: Joint Startup Projects [relates_to] Career Development');

    // 9. Update some existing nodes with richer notes
    console.log('\nAdding notes to existing nodes...');

    // Add note to Startup concept
    await neo4jService.executeRaw(`
      MATCH (c:Concept {entity_key: $startupKey})
      SET c.notes = 'Exploring startup path through multiple angles: building with Annabeth, considering YC application, weighing against joining established companies like Anthropic. Want to validate product ideas and founding team dynamics before fully committing.'
      RETURN c.name
    `, { startupKey });

    console.log('✓ Updated notes on Startup concept');

    // Add note to Y Combinator concept
    const ycKey = '95d3e754ada3eb3f641052fa94dd5761e36df7523b58959a604491b2dfbf44a4';
    await neo4jService.executeRaw(`
      MATCH (c:Concept {entity_key: $ycKey})
      SET c.notes = 'YC represents a potential accelerator path for joint projects. The network, funding, and validation would be valuable, but timing and readiness are key considerations.'
      RETURN c.name
    `, { ycKey });

    console.log('✓ Updated notes on Y Combinator concept');

    // Add note to Anthropic entity
    const anthropicKey = 'f9c7e9cff76426f9cb71be519213cff7e22ba8cabf64fb5c2c529d08e93b5c78';
    await neo4jService.executeRaw(`
      MATCH (e:Entity {entity_key: $anthropicKey})
      SET e.notes = 'Leading AI safety company. Represents the "join an established company" path vs building own startup. Would offer stability, strong team, cutting-edge work, but less ownership and autonomy than founding.'
      RETURN e.name
    `, { anthropicKey });

    console.log('✓ Updated notes on Anthropic entity');

    // 10. Add Annabeth relationship to some concepts
    await neo4jService.executeRaw(`
      MATCH (annabeth:Person {entity_key: $annabethKey})
      MATCH (startup:Concept {entity_key: $startupKey})
      CREATE (annabeth)-[r:thinks_about {
        mood: 'excited_by',
        frequency: 30,
        created_at: datetime(),
        updated_at: datetime()
      }]->(startup)
      RETURN type(r)
    `, { annabethKey, startupKey });

    console.log('✓ Created: Annabeth [thinks_about] Startup');

    console.log('\n✅ All changes completed successfully!');

    // Verification
    const verifyResult = await neo4jService.executeRaw(`
      MATCH (annabeth:Person {entity_key: $annabethKey})-[r]-(n)
      RETURN count(r) as totalRelationships
    `, { annabethKey });

    const totalRels = verifyResult[0].get('totalRelationships').toNumber();
    console.log(`\nVerification: Annabeth node has ${totalRels} relationships`);

  } finally {
    await neo4jService.close();
  }
}

main();
